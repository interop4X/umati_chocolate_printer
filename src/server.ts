import util from "util";
import { NodeId, OPCUAServer, nodesets, UAVariable, BaseNode, UAObject } from "node-opcua";
import * as path from "path";
import { MachineryItemState } from "./machineryItemState";
import { RootDict } from "./filesystem";
import { LifetimeCounter, OperationCounters } from "./counters";
import { CounterStore } from "./persistence/CounterStore";
import { JobManagementService } from "./jobmanagement";
import { createPdf } from "./labelCreator";
import { StackLight } from "./stacklight";
import { initIdentification } from "./identification/initIdentification";
import { initEnergyMonitoring } from "./monitoring/initEnergyMonitoring";
import { GlassEventService } from "./events";

const { exec } = require("child_process");

const execAsync = util.promisify(exec);

// Hauptfunktion zur Erstellung des OPC UA Servers
async function main() {
    // Advertise an address that remote OPC UA clients can actually resolve/reach.
    // The OS hostname (for example *.VDMA.LOCAL) is only valid in the local network.
    const opcuaHostname = process.env.OPCUA_HOSTNAME || "100.96.1.3";

    const stackLight = new StackLight('/dev/ttyUSB0', 9600);
    await stackLight.setLightSync('yellow');
    await stackLight.setFlashSync('normal');

    // Definiere den Pfad zu den XML-Dateien
    const xmlFiles = [
        nodesets.standard, // Standard OPC UA Nodeset
        path.join(__dirname, "..", "models", "demo_siemens.xml"),
        //path.join(__dirname, "..", "models", "Opc.Ua.Di.NodeSet2.xml"), // DI Nodeset
        //path.join(__dirname, "..", "models", "opc.ua.isa95-jobcontrol.nodeset2.xml"), // ISA95-JobControl Nodeset
        //path.join(__dirname, "..", "models", "Opc.Ua.Machinery.NodeSet2.xml"), // Machinery Nodeset
        //path.join(__dirname, "..", "models", "Opc.Ua.Machinery.Jobs.NodeSet2.xml"), // Machinery Jobs Nodeset
        path.join(__dirname, "..", "models", "opc.ua.glas.v2.nodeset2.xml"), // Glas Nodeset
        nodesets.ia,
        path.join(__dirname, "..", "models", "ECM", "Opc.Ua.ECM.NodeSet2.xml"), // Glas Flat Nodeset
        path.join(__dirname, "..", "models", "Opc.Ua.Machinery.Energy.NodeSet2.xml"), // Machinery Energy Nodeset
    ];

    // OPC UA Server Konfiguration
    const server = new OPCUAServer({
        hostname: opcuaHostname,
        port: 48030, // Der Port, auf dem der Server läuft
        resourcePath: "", // Endpunkt
        buildInfo: {
            productName: "interop4X - Choco Cutting Table",
            buildNumber: "1",
            buildDate: new Date(),
        },
        nodeset_filename: xmlFiles, // Die Nodeset-Dateien werden hier übergeben
        maxConnectionsPerEndpoint : 50,
        maxAllowedSessionNumber : 50
    });

    // Initialisiere den Server
    await server.initialize();

    // Starte den Server
    await server.start();
    console.log("OPC UA Server läuft! Drücke Strg+C zum Beenden.");


    const myNamespace = server.engine.addressSpace?.registerNamespace("urn:de.interop4X.opcua.choco_cutting_table");
    if (!myNamespace) {
        throw new Error("Could not register own namespace.");
    }

    const machine_folder_nid = new NodeId(NodeId.NodeIdType.NUMERIC, 1001, server.engine.addressSpace?.getNamespaceIndex("http://opcfoundation.org/UA/Machinery/"));
    const machine_folder = server.engine.addressSpace?.findNode(machine_folder_nid);
    if (!machine_folder) {
        throw new Error("Machine folder not found in address space.");
    }

    const glassmachinetype_nid = new NodeId(NodeId.NodeIdType.NUMERIC, 1015, server.engine.addressSpace?.getNamespaceIndex("http://opcfoundation.org/UA/Glass/Flat/v2/"));
    const glassmachinetype = server.engine.addressSpace?.findObjectType(glassmachinetype_nid);
    if (!glassmachinetype) {
        throw new Error("glassmachinetype not found in address space.");
    }
    const machine = glassmachinetype?.instantiate(
        {
            organizedBy: machine_folder, // Definiere, wo diese Instanz im Adressraum organisiert ist
            browseName: "ChocoCuttingTable",
            namespace:  myNamespace,
            optionals: [
                "MachineryBuildingBlocks.JobManagement.JobOrderControl.Store",
                "MachineryBuildingBlocks.JobManagement.JobOrderControl.Start",
                "MachineryBuildingBlocks.JobManagement.JobOrderControl.StoreAndStart",
                "MachineryBuildingBlocks.JobManagement.JobOrderControl.Clear",
                "MachineryBuildingBlocks.JobManagement.MachineryItemState.CurrentState.Number",
                "Identification.Model",
                "Identification.SoftwareRevision",
                "Identification.YearOfConstruction",
                "Identification.DeviceClass",
                "Identification.Location",
                "MachineryBuildingBlocks.OperationCounters.OperationCycleCounter",
                "MachineryBuildingBlocks.OperationCounters.OperationDuration",
                "MachineryBuildingBlocks.OperationCounters.PowerOnDuration",
                "MachineryBuildingBlocks.Monitoring.Consumption"
                //"OptionalObject"
            ] // Liste der optionalen Elemente, die du instanziieren möchtest
        }
    )
    const machinery_idx = server.engine.addressSpace?.getNamespaceIndex("http://opcfoundation.org/UA/Machinery/") as number;
    const device_idx = server.engine.addressSpace?.getNamespaceIndex("http://opcfoundation.org/UA/DI/") as number;
    const isa95_idx = server.engine.addressSpace?.getNamespaceIndex("http://opcfoundation.org/UA/ISA95-JOBCONTROL_V2/") as number;

    const bb_folder = machine.getChildByName("MachineryBuildingBlocks") as UAObject;
    const MachineryBuildingBlocks = machine.getChildByName("MachineryBuildingBlocks");
    const counterStore = new CounterStore(path.join(__dirname, "..", "state", "counters.json"));
    const lifetimeCounter = new LifetimeCounter(
        server,
        bb_folder,
        machinery_idx,
        device_idx,
        counterStore,
        myNamespace
    );
    const operationCounterManager = new OperationCounters(MachineryBuildingBlocks!, counterStore);

    const fileSystemRoot = machine.getChildByName("FileSystem") as UAObject;
    const root = new RootDict(server, __dirname + "/../data", fileSystemRoot!, myNamespace);

    let mymachineryItemState!: MachineryItemState;

    initIdentification({
        server,
        machine,
        deviceNamespaceIndex: device_idx
    });
    initMachineryItem();
    await initEnergyMonitoring({
        server,
        machineryBuildingBlocks: bb_folder,
        myNamespace,
        machineryNamespaceIndex: machinery_idx
    });

    const dataDirectory = path.resolve(__dirname, "../data");
    const glassEvents = new GlassEventService({
        server,
        source: machine,
        namespace: myNamespace
    });
    const jobManagementService = new JobManagementService(
        server,
        MachineryBuildingBlocks as UAObject,
        isa95_idx,
        {
            dataDirectory,
            onJobStart: (jobOrderId: string) => {
                console.log(`Drucke Dokument: ${jobOrderId}`);
                mymachineryItemState.setCurrentStateByText(mymachineryItemState.possibleStates.Executing.text);
                stackLight.setLightSync("green");
                stackLight.setFlashSync("fast");
            },
            executeJob: async (jobOrderId: string, recipePath: string, source: "umati" | "default") => {
                console.log("Job " + jobOrderId + ": Rezeptdatei " + recipePath + ", Quelle " + source);
                const totalDurationMs = 20 * 1000;
                const prepareDurationMs = Math.floor(totalDurationMs * 0.2);
                const printDurationMs = totalDurationMs - prepareDurationMs;

                glassEvents.raiseComponentIn(jobOrderId);

                jobManagementService.setRunningSubState(jobOrderId, "PreparePrint");
                await SimulateJob(prepareDurationMs);

                jobManagementService.setRunningSubState(jobOrderId, "Print");
                glassEvents.raiseProcessingIn(jobOrderId);
                const tempPdfPath = path.join(__dirname, "../data", `${jobOrderId}.pdf`);
                await createPdf(jobOrderId, tempPdfPath, recipePath, source);
                await PrintLabel(tempPdfPath);
                operationCounterManager.incrementCycleCounter();
                lifetimeCounter.increment();
                await SimulateJob(printDurationMs);

                glassEvents.raiseProcessingOut(jobOrderId);
                glassEvents.raiseComponentOut(jobOrderId);
            },
            onJobSuccess: () => {
                console.log("Druckauftrag erfolgreich gesendet!");
                stackLight.setLightSync("yellow");
                stackLight.setFlashSync("normal");
                mymachineryItemState.setCurrentStateByText(mymachineryItemState.possibleStates.NotExecuting.text);
            },
            onJobFailure: (_jobOrderId: string, error: unknown) => {
                console.error("Fehler beim Drucken:", error);
                stackLight.setLightSync("yellow");
                stackLight.setFlashSync("normal");
                mymachineryItemState.setCurrentStateByText(mymachineryItemState.possibleStates.NotExecuting.text);
            }
        }
    );
    jobManagementService.startCleanupTimers();


    function initMachineryItem() {
        const machineryItemState_node = MachineryBuildingBlocks?.getChildByName("MachineryItemState");
        mymachineryItemState = new MachineryItemState(machineryItemState_node as BaseNode, machinery_idx);
        mymachineryItemState.setCurrentStateByText(mymachineryItemState.possibleStates.NotExecuting.text);

        const machineryOperationMode_node = MachineryBuildingBlocks?.getChildByName("MachineryOperationMode");
        const currentState_node = machineryOperationMode_node?.getChildByName("CurrentState") as UAVariable;
        const currentState_id_node = currentState_node?.getChildByName("Id") as UAVariable;
        const currentState_number_node = currentState_node?.getChildByName("Number") as UAVariable;
        currentState_node.setValueFromSource(            {
            value: "Processing",
            dataType: "LocalizedText"
        });

    }

    // Endpunkt anzeigen
    console.log("Server is now listening on: ", server.getEndpointUrl());

    function SimulateJob(duration: number = 5000) {
        console.log("sim job");
        const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
        operationCounterManager.addOperationDuration(duration);
        return sleep(duration);
    }

    function PrintLabel(tempPdfPath: string) {
        console.log("print file");
        const printerName = "label";
        const command = `lp -d ${printerName} "${tempPdfPath}" -o media=Custom.90x40mm -o orientation-requested=4 -o fit-to-page`;
        return execAsync(command)
            .then(({ stdout, stderr }: { stdout: string; stderr: string; }) => {
                if (stderr) {
                    console.error('Fehler beim Drucken:', stderr);
                } else {
                    console.log('Druckauftrag erfolgreich:', stdout);
                }
            })
            .catch((error: Error) => {
                console.error('Druckbefehl fehlgeschlagen:', error);
            });
    }
}

// Führe die Hauptfunktion aus
main().catch((error) => {
    console.error("Error: ", error);
});
