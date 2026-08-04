import util from "util";
import { Console, log } from "console";
import { NodeId, NodeIdType, OPCUAServer, UAFile, nodesets, UAMethod, StatusCodes, UAVariable, DataType, Variant, BrowsePath, VariantArrayType, BaseNode, LocalizedText, UAObject } from "node-opcua";
import { EUInformation } from "node-opcua-data-access";
import * as path from "path";
import { MachineryItemState } from "./machineryItemState";
import { RootDict } from "./filesystem";
import { LifetimeCounter, OperationCounters } from "./counters";
import { CounterStore } from "./persistence/CounterStore";
import { JobResponseManager } from "./jobmanagement";
import { createPdf } from "./labelCreator";
import {StackLight} from "./stacklight";

import { promisify } from "util";
import { ShellyPlugClient } from "./ShellyPlugClient";
const { exec } = require("child_process");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const printer = require("pdf-to-printer");

const execAsync = util.promisify(exec);

enum Isa95ReturnStatusBit {
    NoError = 0,
    UnknownJobOrderId = 1,
    InvalidJobOrderStatus = 3,
    UnableToAcceptJobOrder = 4,
    InvalidRequest = 32
}

function isa95ReturnStatus(bit: Isa95ReturnStatusBit): Variant {
    const value: [number, number] = bit < 32
        ? [0, Math.pow(2, bit)]
        : [Math.pow(2, bit - 32), 0];

    return new Variant({
        dataType: DataType.UInt64,
        arrayType: VariantArrayType.Scalar,
        value
    });
}

function isa95MethodResult(bit: Isa95ReturnStatusBit) {
    return {
        statusCode: StatusCodes.Good,
        outputArguments: [isa95ReturnStatus(bit)]
    };
}

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

    initIdentifcation();
    initMachineryItem();
    InitCleanupAbortedJobs(); // 10 Sekunden Intervall
    InitCleanupOldJobs();
    InitEnergyMonitoring(); 


    const { jobOrderList, jobOrderControl, jobOrderResults } = initJobManagement();
    const jobResponseManager = new JobResponseManager(
        server,
        jobOrderResults as UAObject,
        jobOrderList,
        isa95_idx
    );


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

    function initJobManagement() {
        const jobManagement = MachineryBuildingBlocks?.getChildByName("JobManagement");
        const jobOrderControl = jobManagement?.getChildByName("JobOrderControl");
        const jobOrderResults = jobManagement?.getChildByName("JobOrderResults");

        const jobOrderList = jobOrderControl?.getChildByName("JobOrderList") as UAVariable;
        const jobOrderRequest = server.engine.addressSpace?.findDataType("ISA95JobOrderDataType");

        var list = jobOrderList.readValue();
        var list_value = list.value;
        list_value.value = [];
        list_value.arrayType = VariantArrayType.Array;
        list_value.dimensions = [0];
        jobOrderList.setValueFromSource(list_value);
        return { jobOrderList, jobOrderControl, jobOrderResults };
    }

    var mymachineryItemState : MachineryItemState;
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

    function store(inputArguments: Variant[], context: any, callback: any) {
        // Logik der Methode hier
        // inputArguments enthält die übergebenen Argumente
        const inputJobOrder = inputArguments[0]?.value;
        const jobOrderID = inputJobOrder?.jobOrderID;
        if (typeof jobOrderID !== "string" || !jobOrderID.trim()) {
            callback(null, isa95MethodResult(Isa95ReturnStatusBit.InvalidRequest));
            return;
        }

        const currentJobs = jobOrderList.readValue().value.value;
        if (!Array.isArray(currentJobs)) {
            callback(null, isa95MethodResult(Isa95ReturnStatusBit.UnableToAcceptJobOrder));
            return;
        }
        if (currentJobs.some((entry: any) => entry?.jobOrder?.jobOrderID === jobOrderID)) {
            callback(null, isa95MethodResult(Isa95ReturnStatusBit.UnableToAcceptJobOrder));
            return;
        }
        //const comment = inputArguments[1].value;
        //machine_state.printJobManager.addJob(new machine_state.)
        // Beispiel: Addition der Eingabewerte
        var newState = server.engine.addressSpace?.constructExtensionObject(new NodeId(NodeIdType.NUMERIC, 3006, server.engine.addressSpace?.getNamespaceIndex("http://opcfoundation.org/UA/ISA95-JOBCONTROL_V2/")), {
            browsePath: null,
            stateText: "NotAllowedToStart",
            stateNumber: "1"
        });
        console.log("State" + newState);
        var orderAndState = server.engine.addressSpace?.constructExtensionObject(new NodeId(NodeIdType.NUMERIC, 3015, server.engine.addressSpace?.getNamespaceIndex("http://opcfoundation.org/UA/ISA95-JOBCONTROL_V2/")), {
            //jobOrder : inputJobOrder,
            //state : newState
        }) as any;
        orderAndState.jobOrder = inputJobOrder;
        orderAndState.state[0] = newState;

        console.log(orderAndState);
        var listEntry: Variant = new Variant(
            {
                value: orderAndState,
                dataType: DataType.ExtensionObject,
            }
        )
        var list = jobOrderList.readValue();
        var list_value = list.value;
        list_value.value.push(orderAndState);
        list_value.dimensions![0] = list_value.dimensions![0] + 1;

        jobOrderList.setValueFromSource(list_value);

        // Callback aufrufen, um die Ergebnisse an den Client zurückzugeben
        callback(null, isa95MethodResult(Isa95ReturnStatusBit.NoError));
    };

    const storeMethod = jobOrderControl?.getChildByName("Store") as UAMethod;
    const storeandStartMethod = jobOrderControl?.getChildByName("StoreAndStart") as UAMethod;
    storeMethod.bindMethod(store);
    storeandStartMethod.bindMethod(store);
    const startMethod = jobOrderControl?.getChildByName("Start") as UAMethod;
    startMethod.bindMethod(function (inputArguments, context, callback) {
        const jobOrderID = inputArguments[0]?.value;
        if (typeof jobOrderID !== "string" || !jobOrderID.trim()) {
            callback(null, isa95MethodResult(Isa95ReturnStatusBit.InvalidRequest));
            return;
        }
        console.log(`Drucke Dokument: ${jobOrderID}`);


        const list = jobOrderList.readValue();
        if (!Array.isArray(list.value.value)) {
            callback(null, isa95MethodResult(Isa95ReturnStatusBit.InvalidRequest));
            return;
        }
        const theJob = list.value.value.find((job: any) => {
            return job?.jobOrder?.jobOrderID === jobOrderID;
        });    
        if (!theJob){
            console.log(`Job ${jobOrderID} not found!`); 
            callback(null, isa95MethodResult(Isa95ReturnStatusBit.UnknownJobOrderId));
            return;
        }

        const jobState = theJob.state?.[0]?.stateNumber;
        if (jobState !== 1 && jobState !== 2) {
            console.log(`Job ${jobOrderID} has invalid status ${jobState} for Start`);
            callback(null, isa95MethodResult(Isa95ReturnStatusBit.InvalidJobOrderStatus));
            return;
        }

        mymachineryItemState.setCurrentStateByText(mymachineryItemState.possibleStates.Executing.text);
        jobResponseManager.start(jobOrderID);
        theJob.state[0].stateNumber = 3;
        theJob.state[0].stateText = "Running";
        jobOrderList.setValueFromSource(list.value);
        stackLight.setLightSync('green');
        stackLight.setFlashSync('fast');

        // Es können mehrere WorkMaster angegeben sein. Der erste vollständige
        // LocalPath wird verwendet; unvollständige Jobs nutzen das Default-Rezept.
        const source = theJob.jobOrder.jobOrderParameters ? "umati" : "default";
        const dataDirectory = path.resolve(__dirname, "../data");
        const defaultRecipePath = path.join(dataDirectory, "default.json");
        const workMasters = theJob.jobOrder.workMasterID;
        let tempRecipePath = defaultRecipePath;

        if (Array.isArray(workMasters) && workMasters.length > 0) {
            const localPathParameter = workMasters
                .flatMap((workMaster: any) =>
                    Array.isArray(workMaster?.parameters) ? workMaster.parameters : []
                )
                .find((parameter: any) => parameter?.ID === "LocalPath");
            const localPath = localPathParameter?.value?.value;

            if (typeof localPath === "string" && localPath.trim()) {
                const candidatePath = path.resolve(dataDirectory, localPath.trim());
                const isInsideDataDirectory =
                    candidatePath === dataDirectory ||
                    candidatePath.startsWith(dataDirectory + path.sep);

                if (isInsideDataDirectory && fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile()) {
                    tempRecipePath = candidatePath;
                } else {
                    console.warn(
                        "Job " + jobOrderID + ": WorkMaster LocalPath \"" + localPath + "\" ist ungültig " +
                        "oder nicht vorhanden. Verwende default.json."
                    );
                }
            } else {
                console.warn(
                    "Job " + jobOrderID + ": WorkMaster enthält keinen gültigen LocalPath. " +
                    "Verwende default.json."
                );
            }
        } else {
            console.warn("Job " + jobOrderID + ": Kein WorkMaster angegeben. Verwende default.json.");
        }

        console.log("Job " + jobOrderID + ": Rezeptdatei " + tempRecipePath + ", Quelle " + source);
        // Temporäre Datei erstellen, die gedruckt werden soll
        const tempPdfPath = path.join(__dirname,"../data",`${jobOrderID}.pdf`);

        callback(null, isa95MethodResult(Isa95ReturnStatusBit.NoError));


        // Erstelle die PDF-Datei und drucke sie
        createPdf(jobOrderID, tempPdfPath,tempRecipePath,source)
            .then((filePath : any) => {
                return PrintLabel(tempPdfPath);
            })
            .then(()=>{
                operationCounterManager.incrementCycleCounter();
                lifetimeCounter.increment();
                return SimulateJob(20 * 1000); 
            })
            .then(() => {
                console.log("Druckauftrag erfolgreich gesendet!");
                stackLight.setLightSync('yellow');
                stackLight.setFlashSync('normal');
                mymachineryItemState.setCurrentStateByText(mymachineryItemState.possibleStates.NotExecuting.text);
                theJob.state[0].stateNumber = 5;
                theJob.state[0].stateText = "Ended";
                jobOrderList.setValueFromSource(list.value);
                jobResponseManager.complete(jobOrderID);
                // Erfolgreiche Rückgabe an den Client
      
            })
            .catch((error : any) => {
                theJob.state[0].stateNumber = 6;
                theJob.state[0].stateText = "Aborted";
                jobOrderList.setValueFromSource(list.value);
                jobResponseManager.complete(jobOrderID);
                console.error("Fehler beim Drucken:", error);
                mymachineryItemState.setCurrentStateByText(mymachineryItemState.possibleStates.NotExecuting.text);
            });

    });


    


    // Endpunkt anzeigen
    console.log("Server is now listening on: ", server.getEndpointUrl());



    function InitCleanupAbortedJobs() {
        setInterval(() => {
            var i;
            var list = jobOrderList.readValue();
            //console.log(list.value.value);
            for (i in list.value.value) {
                var job = (list.value.value[i]);
                //console.log(job.state);
                if (job.state[0].stateNumber == 6) {
                    console.log("Aborted->End");
                    list.value.value[i].state[0].stateNumber = 5;
                    list.value.value[i].state[0].stateText = "Ended";

                }
            }
            jobOrderList.setValueFromSource(list.value);
        }, 5 * 1000);
    }

    function InitCleanupOldJobs() {
        setInterval(() => {
            var list = jobOrderList.readValue();
            //console.log(list.value.value);
            for (let i = list.value.value.length - 1; i >= 0; i--) {
                var job = (list.value.value[i]);
                //console.log(job.state);
                if (job.state[0].stateNumber == 5) {
                    console.log("Remove job");
                    jobResponseManager.remove(job.jobOrder.jobOrderID);
                    list.value.value.splice(i, 1);
                    list.value.dimensions![0] = list.value.dimensions![0] - 1;
                }
            }
            jobOrderList.setValueFromSource(list.value);
        }, 7 * 60 * 60 * 1000);
    }

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
