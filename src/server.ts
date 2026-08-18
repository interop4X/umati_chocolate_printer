import util from "util";
import { Console, log } from "console";
import { NodeId, NodeIdType, OPCUAServer, UAFile, nodesets, UAVariable, DataType, BaseNode, LocalizedText, UAObject } from "node-opcua";
import { EUInformation } from "node-opcua-data-access";
import * as path from "path";
import { MachineryItemState } from "./machineryItemState";
import { RootDict } from "./filesystem";
import { LifetimeCounter, OperationCounters } from "./counters";
import { CounterStore } from "./persistence/CounterStore";
import { JobManagementService } from "./jobmanagement";
import { createPdf } from "./labelCreator";
import {StackLight} from "./stacklight";

import { promisify } from "util";
import { ShellyPlugClient } from "./ShellyPlugClient";
const { exec } = require("child_process");
const PDFDocument = require("pdfkit");
const printer = require("pdf-to-printer");

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
                "MachineryBuildingBlocks.JobManagement.MachineryItemState.CurrentState.Number",
                "Identification.Model",
                "Identification.SoftwareRevision",
                "Identification.YearOfConstruction",
                "Identification.DeviceClass",
                "Identification.Location",
                "MachineryBuildingBlocks.OperationCounters.OperationCycleCounter",
                "MachineryBuildingBlocks.OperationCounters.OperationDuration",
                "MachineryBuildingBlocks.OperationCounters.PowerOnDuration"
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
        counterStore
    );
    const operationCounterManager = new OperationCounters(MachineryBuildingBlocks!, counterStore);

    const fileSystemRoot = machine.getChildByName("FileSystem") as UAObject;
    const root = new RootDict(server,__dirname + "/../data", fileSystemRoot!);

    var mymachineryItemState : MachineryItemState;
    initIdentifcation();
    initMachineryItem();
    InitEnergyMonitoring();

    const dataDirectory = path.resolve(__dirname, "../data");
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
                const tempPdfPath = path.join(__dirname, "../data", `${jobOrderId}.pdf`);
                await createPdf(jobOrderId, tempPdfPath, recipePath, source);
                await PrintLabel(tempPdfPath);
                operationCounterManager.incrementCycleCounter();
                lifetimeCounter.increment();
                await SimulateJob(20 * 1000);
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


    function setChildValue(parent: UAVariable, childName: string, value: any, dataType: DataType) {
        const child = parent.getChildByName(childName) as UAVariable;
        if (child) {
            child.setValueFromSource({
                value: value,
                dataType: dataType
            });
        } else {
            console.warn(`Child node not found for setting value: ${parent.browseName.toString()}-${childName}`);
        }
    }

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

    function initIdentifcation() {
        const identifcation = machine?.getChildByName("Identification", device_idx)as UAVariable;

        setChildValue(identifcation, "Manufacturer", new LocalizedText("interop4X"), DataType.LocalizedText);
        setChildValue(identifcation, "ProductInstanceUri", "interop4X.de/choco_cutting_table/123456789", DataType.String);

        var Categorie = server.engine.addressSpace?.constructExtensionObject(
            new NodeId(NodeIdType.NUMERIC, 3014, server.engine.addressSpace?.getNamespaceIndex("http://opcfoundation.org/UA/Glass/Flat/v2/")), {
            ID: "LabelPrinting",
            Description: "Label printing"
            }
        );
        setChildValue(identifcation, "ProcessingCategories", Categorie, DataType.ExtensionObject);
        setChildValue(identifcation, "SerialNumber", "123456789", DataType.String);
        setChildValue(identifcation, "Model", new LocalizedText("Model 42"), DataType.LocalizedText);
        setChildValue(identifcation, "SoftwareRevision", "0.4.2", DataType.String);
        setChildValue(identifcation, "YearOfConstruction", 2024, DataType.UInt16);
        setChildValue(identifcation, "DeviceClass", "Cutting Table", DataType.String);
        setChildValue(identifcation, "Location", "ASER B5 224/AMTC B5 224/VIRTUAL 1 1/", DataType.String);
    }

    // Endpunkt anzeigen
    console.log("Server is now listening on: ", server.getEndpointUrl());

    async function InitEnergyMonitoring() {
        const ecm_idx = server.engine.addressSpace?.getNamespaceIndex("http://opcfoundation.org/UA/ECM/") as number;
        const energyType = server.engine.addressSpace?.findObjectType("IEnergyProfileE1Type",ecm_idx)

        const myEnergyProfileE1Type = myNamespace?.addObjectType({
            browseName: "EnergyProfileE1Type",
            subtypeOf: energyType!,
        });
    
        const energy_bb = myEnergyProfileE1Type?.instantiate({
            organizedBy: bb_folder,
            browseName: "EnergyMeasurement"
        });
        const power_node = energy_bb?.getChildByName("AcActivePowerTotal") as UAVariable;
        const shelly = new ShellyPlugClient("192.168.33.1");
        try{
            var result = await shelly.setPowerOn();   // Gerät einschalten
            console.log("Shelly Plug eingeschaltet");
            if (!result) {
                console.error("Fehler beim Einschalten des Shelly Plugs");
                return;
            }
            setInterval(async () => {
                const power = await shelly.getActivePower();
                power_node?.setValueFromSource({
                    value: power,
                    dataType: DataType.Float
            });
            }, 500);

        } catch (error) {
            console.error("Fehler beim Einschalten des Shelly Plugs:", error);
        }


    }

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
