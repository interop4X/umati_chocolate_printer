import util from "util";
import { Console, log } from "console";
import { NodeId, NodeIdType, OPCUAServer, UAFile, nodesets, UAMethod, StatusCodes, UAVariable, DataType, Variant, BrowsePath, VariantArrayType, BaseNode, LocalizedText, UAObject, QualifiedName } from "node-opcua";
import { EUInformation } from "node-opcua-data-access";
import * as path from "path";
import { MachineryItemState } from "./machineryItemState";
import { FileBaseSystem, RootDict, File } from "./file";
import { createPdf } from "./labelCreator";
import {StackLight} from "./stacklight";

import { promisify } from "util";
import { ShellyPlugClient } from "./ShellyPlugClient";
const { exec } = require("child_process");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const printer = require("pdf-to-printer");

const execAsync = util.promisify(exec);

// Hauptfunktion zur Erstellung des OPC UA Servers
async function main() {
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

    const bb_folder = machine.getChildByName("MachineryBuildingBlocks") as UAObject;
  

    const bb_lifetime_folder_type_node = server.engine.addressSpace?.findObjectType("MachineryLifetimeCounterType",machinery_idx)

    const myLifetimeVar = createLifetimeVariable();

    const fileSystemRoot = machine.getChildByName("FileSystem") as UAObject;
    const root = new RootDict(server,__dirname + "/../data", fileSystemRoot!);

    const createFileMethod = fileSystemRoot.getMethodByName("CreateFile");
    createFileMethod?.bindMethod(function (inputArguments, context, callback) {
        console.log("Add new file:");
        const fileName = inputArguments[0].value;
        const requestFileOpen = inputArguments[1].value;
        console.log(fileName);
        var tmp : File = new File(server, fileName, root);
        root.addFile(tmp);
        if (requestFileOpen) {
            var args: Variant[] = [];
            args.push(new Variant({
                dataType: DataType.Byte,
                arrayType: VariantArrayType.Scalar,
                value: 7
            }));
            
            // Asynchrone Methode aufrufen und auf das Ergebnis warten
            tmp.opcuaObject.open.execute(tmp.opcuaObject, args, context).then(
                (result) => {
                    console.log("Das Ergebnis des Methodenaufrufs:", result);
                    // Ergebnis auswerten und fileHandle setzen
                    var fileHandle = result.outputArguments![0]?.value ?? 1;
        
                    // Rückgabe an den Client nach erfolgreicher Ausführung
                    const callMethodResult = {
                        statusCode: StatusCodes.Good,
                        outputArguments: [{
                            dataType: DataType.NodeId,
                            arrayType: VariantArrayType.Scalar,
                            value: tmp.opcuaObject.nodeId
                        }, {
                            dataType: DataType.UInt32,
                            arrayType: VariantArrayType.Scalar,
                            value: fileHandle
                        }]
                    };
                    // Callback aufrufen, um das Ergebnis zurückzugeben
                    callback(null, callMethodResult);
                }
            ).catch((error) => {
                console.error("Fehler beim Aufruf der Methode:", error);
                // Bei einem Fehler wird der Callback mit einer Fehlermeldung aufgerufen
                callback(error);
            });
        
        } else {
            // Wenn kein requestFileOpen erforderlich ist, direkt das Ergebnis zurückgeben
            const callMethodResult = {
                statusCode: StatusCodes.Good,
                outputArguments: [{
                    dataType: DataType.NodeId,
                    arrayType: VariantArrayType.Scalar,
                    value: tmp.opcuaObject.nodeId
                }, {
                    dataType: DataType.UInt32,
                    arrayType: VariantArrayType.Scalar,
                    value: 0
                }]
            };
            callback(null, callMethodResult);
        }
    });

    const MachineryBuildingBlocks = machine.getChildByName("MachineryBuildingBlocks");

    initIdentifcation();
    initMachineryItem();
    InitCleanupAbortedJobs(); // 10 Sekunden Intervall
    InitCleanupOldJobs();
    InitEnergyMonitoring(); 


    const { jobOrderList, jobOrderControl } = initJobManagement();


    function createLifetimeVariable() {
    const bb_lifetime_folder_node = bb_lifetime_folder_type_node?.instantiate({
        organizedBy: bb_folder,
        browseName: new QualifiedName({
            namespaceIndex:machinery_idx,
            name:"LifetimeCounters"
        })
    });
        const LifetimeVariableType = server.engine.addressSpace?.findVariableType("LifetimeVariableType", device_idx);
        const myLifetimeVar = LifetimeVariableType?.instantiate({
            organizedBy: bb_lifetime_folder_node,
            browseName: new QualifiedName({
                namespaceIndex: machinery_idx,
                name: "Paper"
            }),
            optionals: [
                "Indication"
            ]
        });
        
        myLifetimeVar?.setValueFromSource({
            value: 0,
            dataType: DataType.UInt32
        });
        var tmp = 0;
        setChildValue(myLifetimeVar!, "StartValue", tmp, DataType.UInt32);
        setChildValue(myLifetimeVar!, "LimitValue", tmp, DataType.UInt32);
        //var Indication = new NodeId(device_idx, 475)
        //setChildValue(myLifetimeVar!, "Indication", Indication, DataType.NodeId);

        return myLifetimeVar;
    }

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

        const jobOrderList = jobOrderControl?.getChildByName("JobOrderList") as UAVariable;
        const jobOrderRequest = server.engine.addressSpace?.findDataType("ISA95JobOrderDataType");

        var list = jobOrderList.readValue();
        var list_value = list.value;
        list_value.value = [];
        list_value.arrayType = VariantArrayType.Array;
        list_value.dimensions = [0];
        jobOrderList.setValueFromSource(list_value);
        return { jobOrderList, jobOrderControl };
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
        const identifcation = machine?.getChildByName("Identification", device_idx);

        var tmp = identifcation?.getChildByName("Manufacturer", device_idx) as UAVariable;
        tmp.setValueFromSource({
            value: new LocalizedText("interop4X"),
            dataType: DataType.LocalizedText
        });

        var tmp = identifcation?.getChildByName("ProductInstanceUri") as UAVariable;
        tmp.setValueFromSource({
            value: "interop4X.de/choco_cutting_table/123456789",
            dataType: DataType.String
        });

        var Categorie = server.engine.addressSpace?.constructExtensionObject(new NodeId(NodeIdType.NUMERIC, 3014, server.engine.addressSpace?.getNamespaceIndex("http://opcfoundation.org/UA/Glass/Flat/v2/")), {
            ID: "LabelPrinting",
            Description: "Label printing"
        });
        var tmp = identifcation?.getChildByName("ProcessingCategories") as UAVariable;
        tmp.setValueFromSource({
            value: Categorie,
            dataType: DataType.ExtensionObject
        });


        var tmp = identifcation?.getChildByName("SerialNumber") as UAVariable;
        tmp.setValueFromSource({
            value: "123456789",
            dataType: DataType.String
        });

        var tmp = identifcation?.getChildByName("Model") as UAVariable;
        tmp?.setValueFromSource({
            value: new LocalizedText("Model 42"),
            dataType: DataType.LocalizedText
        });

        var tmp = identifcation?.getChildByName("SoftwareRevision") as UAVariable;
        tmp?.setValueFromSource({
            value: "0.0.1",
            dataType: DataType.String
        });
        var tmp = identifcation?.getChildByName("YearOfConstruction") as UAVariable;
        tmp?.setValueFromSource({
            value: "2024",
            dataType: DataType.UInt16
        });

        var tmp = identifcation?.getChildByName("DeviceClass") as UAVariable;
        tmp?.setValueFromSource({
            value: "Cutting Table",
            dataType: DataType.String
        });

        var tmp = identifcation?.getChildByName("Location") as UAVariable;
        tmp?.setValueFromSource({
            value: "glass 15 A43 / 51.262752, 6.743782",
            dataType: DataType.String
        });
    }

    function store(inputArguments: Variant[], context: any, callback: any) {
        // Logik der Methode hier
        // inputArguments enthält die übergebenen Argumente
        const inputJobOrder = inputArguments[0].value;
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

        // Rückgabe der Ergebnisse
        const callMethodResult = {
            statusCode: StatusCodes.Good,
            outputArguments: [{
                dataType: DataType.UInt64,
                value: 0
            }
            ]
        };

        // Callback aufrufen, um die Ergebnisse an den Client zurückzugeben
        callback(null, callMethodResult);
    };

    const storeMethod = jobOrderControl?.getChildByName("Store") as UAMethod;
    const storeandStartMethod = jobOrderControl?.getChildByName("StoreAndStart") as UAMethod;
    storeMethod.bindMethod(store);
    storeandStartMethod.bindMethod(store);
    const operationCounters = MachineryBuildingBlocks?.getChildByName("OperationCounters");
    const OperationCycleCounter = operationCounters?.getChildByName("OperationCycleCounter") as UAVariable;

    const startMethod = jobOrderControl?.getChildByName("Start") as UAMethod;
    startMethod.bindMethod(function (inputArguments, context, callback) {
        const jobOrderID = inputArguments[0].value;
        console.log(`Drucke Dokument: ${jobOrderID}`);
        mymachineryItemState.setCurrentStateByText(mymachineryItemState.possibleStates.Executing.text);


        const list = jobOrderList.readValue();
        const theJob = list.value.value.find((job: any) => {
            return job.jobOrder.jobOrderID === jobOrderID;
        });    
        if (!theJob){
            console.log(`Job ${jobOrderID} not found!`); 
        }

        theJob.state[0].stateNumber = 3;
        theJob.state[0].stateText = "Running";
        jobOrderList.setValueFromSource(list.value);
        stackLight.setLightSync('green');
        stackLight.setFlashSync('fast');

        // achtung es könnten auch mehrere WorkMaster sein!
        var source = "default"
        if(theJob.jobOrder.jobOrderParameters){
            source =  "umati";
        }
        console.log(source);

        var jobFile ="default.json";
        if (theJob.jobOrder.workMasterID){
	   if (Array.isArray(theJob.jobOrder.workMasterId) && theJob.jobOrder.workMasterId.length > 0){
		
            jobFile = theJob.jobOrder.workMasterID[0].parameters.find((p:any) => p.ID == "LocalPath").value.value;}
	    else {
		console.log("empty workmasterid array");
		}
        }else{
            console.log(`Job ${jobOrderID} No Workmaster is set`);
            console.log(`No localPath in  ${jobOrderID} not found! Use Default!`);
        }

        console.log(jobFile);
        // Temporäre Datei erstellen, die gedruckt werden soll
        const tempPdfPath = path.join(__dirname,"../data",`${jobOrderID}.pdf`);
        const tempRecipePath = path.join(__dirname,"../data",jobFile);

        const callMethodResult = {
            statusCode: StatusCodes.Good,
            outputArguments: [{
                dataType: DataType.UInt64,
                arrayType: VariantArrayType.Scalar,
                value: 0
            }
            ]
        };
        callback(null, callMethodResult);


        // Erstelle die PDF-Datei und drucke sie
        createPdf(jobOrderID, tempPdfPath,tempRecipePath,source)
            .then((filePath : any) => {
                return PrintLabel(tempPdfPath);
            })
            .then(()=>{
                IncreaseOperationCounter();
                IncreaseLifetimeCounter();
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
                // Erfolgreiche Rückgabe an den Client
      
            })
            .catch((error : any) => {
                theJob.state[0].stateNumber = 6;
                theJob.state[0].stateText = "Aborted";
                jobOrderList.setValueFromSource(list);
                console.error("Fehler beim Drucken:", error);
                mymachineryItemState.setCurrentStateByText(mymachineryItemState.possibleStates.NotExecuting.text);
            });

        function IncreaseLifetimeCounter() {
            var lifetimeValue = myLifetimeVar?.readValue();
            myLifetimeVar?.setValueFromSource({
                value: lifetimeValue?.value.value +1,
                dataType: DataType.UInt32
            });
        }

        function IncreaseOperationCounter() {
            var counter = OperationCycleCounter.readValue();
            OperationCycleCounter.setValueFromSource({
                value: counter.value.value + 1,
                dataType: DataType.UInt32
            });
            return counter;
        }
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
            var i;
            var list = jobOrderList.readValue();
            //console.log(list.value.value);
            for (i in list.value.value) {
                var job = (list.value.value[i]);
                //console.log(job.state);
                if (job.state[0].stateNumber == 5) {
                    console.log("Remove job");
                    list.value.value.splice(i);
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
        const operationCounter = MachineryBuildingBlocks?.getChildByName("OperationCounters");
        const OperationDuration = operationCounter?.getChildByName("OperationDuration") as UAVariable;
        var counter = OperationDuration.readValue();
        OperationDuration.setValueFromSource({
            value: counter.value.value + duration,
            dataType: DataType.Double
        });
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
