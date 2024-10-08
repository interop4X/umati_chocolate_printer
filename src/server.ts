import { Console, log } from "console";
import { NodeId, NodeIdType, OPCUAServer, UAFile, nodesets, UAMethod, StatusCodes, UAVariable, DataType, Variant, BrowsePath, VariantArrayType, BaseNode, LocalizedText, UAObject } from "node-opcua";
import * as path from "path";
import { MachineryItemState } from "./machineryItemState";
import { FileBaseSystem, RootDict, File } from "./file";

import { promisify } from "util";
const { exec } = require("child_process");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const printer = require("pdf-to-printer");

function createPdf(JobOrderId: string, outputPath: string, jobFile: string) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({
            size: [40, 90]
        });

        const writeStream = fs.createWriteStream(outputPath);
        doc.pipe(writeStream);

        // Füge den JobOrderId in die PDF-Datei ein
        doc.fontSize(8).text(JobOrderId, 3, 1);

        // Lies den Inhalt der jobFile und füge ihn ins PDF ein
        fs.readFile(jobFile, 'utf8', (err: any, fileContent: string) => {
            if (err) {
                return reject(`Fehler beim Lesen der Datei: ${err}`);
            }

            // Füge den Inhalt der jobFile an einer bestimmten Position ein
            doc.fontSize(3).text(fileContent, 3, 50);  // Position angepasst

            // PDF-Dokument abschließen, nachdem der Inhalt eingefügt wurde
            doc.end();
        });

        // Auf Abschluss des WriteStreams warten
        writeStream.on("finish", () => {
            resolve(outputPath);
        });

        writeStream.on("error", (err:any) => {
            reject(`Fehler beim Schreiben der PDF-Datei: ${err}`);
        });
    });
}

// Hauptfunktion zur Erstellung des OPC UA Servers
async function main() {
    // Definiere den Pfad zu den XML-Dateien
    const xmlFiles = [
        nodesets.standard, // Standard OPC UA Nodeset
        path.join(__dirname, "..", "models", "Opc.Ua.Di.NodeSet2.xml"), // DI Nodeset
        path.join(__dirname, "..", "models", "opc.ua.isa95-jobcontrol.nodeset2.xml"), // ISA95-JobControl Nodeset
        path.join(__dirname, "..", "models", "Opc.Ua.Machinery.NodeSet2.xml"), // Machinery Nodeset
        path.join(__dirname, "..", "models", "Opc.Ua.Machinery.Jobs.NodeSet2.xml"), // Machinery Jobs Nodeset
        path.join(__dirname, "..", "models", "opc.ua.glas.v2.nodeset2.xml"), // Glas Nodeset
    ];

    // OPC UA Server Konfiguration
    const server = new OPCUAServer({
        port: 48400, // Der Port, auf dem der Server läuft
        resourcePath: "", // Endpunkt
        buildInfo: {
            productName: "interop4X - Choco Cutting Table",
            buildNumber: "1",
            buildDate: new Date(),
        },
        nodeset_filename: xmlFiles, // Die Nodeset-Dateien werden hier übergeben
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
                //"OptionalObject"
            ] // Liste der optionalen Elemente, die du instanziieren möchtest
        }
    )
    const machinery_idx = server.engine.addressSpace?.getNamespaceIndex("http://opcfoundation.org/UA/Machinery/") as number;
    const device_idx = server.engine.addressSpace?.getNamespaceIndex("http://opcfoundation.org/UA/DI/") as number;


    const fileSystemRoot = machine.getChildByName("FileSystem") as UAObject;
    const root = new RootDict(server,__dirname + "/../data", fileSystemRoot!);

    const createFileMethod = fileSystemRoot.getMethodByName("CreateFile");
    createFileMethod?.bindMethod(function (inputArguments, context, callback) {
        const fileName = inputArguments[0].value;
        const requestFileOpen = inputArguments[1].value;
        var tmp : File = new File(server, fileName, root);
        root.addFile(tmp);

        // Rückgabe an den Client bei Fehler
        const callMethodResult = {
            statusCode: StatusCodes.Good,
            outputArguments: [{
                dataType: DataType.NodeId ,
                arrayType: VariantArrayType.Scalar,
                value: tmp.opcuaObject.nodeId
            },{
                dataType: DataType.UInt32,
                arrayType: VariantArrayType.Scalar,
                value: 0
            }]
        };
        callback(null, callMethodResult);
    })

    const MachineryBuildingBlocks = machine.getChildByName("MachineryBuildingBlocks");

    initIdentifcation();

    initMachineryItem();



    const { jobOrderList, jobOrderControl } = initJobManagement();


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
            value: new LocalizedText("Test"),
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
            value: "GLASSTEC 15 A43 / 51.262752, 6.743782",
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
        // achtung es könnten auch mehrere WorkMaster sein!
        if (!theJob.jobOrder.workMasterID[0]){
            console.log(`Job ${jobOrderID} No Workmaster is set`); 
        }
        var jobFile = theJob.jobOrder.workMasterID[0].parameters.find((p:any) => p.ID == "localPath")
        if (!jobFile){
            console.log(`No localPath in  ${jobOrderID} not found!`); 
        }
        console.log(jobFile);
        // Temporäre Datei erstellen, die gedruckt werden soll
        const tempPdfPath = path.join(__dirname,"../data",`${jobOrderID}.pdf`);
        const tempRecipePath = path.join(__dirname,"../data",jobFile.value);

        // Erstelle die PDF-Datei und drucke sie
        createPdf(jobOrderID, tempPdfPath,tempRecipePath)
            .then((filePath : any) => {
                console.log("print file");
                /*return printer.print(tempPdfPath, {
                    printer: process.env.PRINTER_NAME || '', // Setze den Druckernamen falls nötig
                    win32: ["-print-settings", "fit"] // Windows-spezifische Einstellungen, z.B. "fit" für Papiergrößenanpassung
                }); // Ersetze "printer_name" mit deinem tatsächlichen Druckernamen*/
            })
            .then(() => {
                console.log("Druckauftrag erfolgreich gesendet!");
                mymachineryItemState.setCurrentStateByText(mymachineryItemState.possibleStates.NotExecuting.text);
                // Erfolgreiche Rückgabe an den Client
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

            })
            .catch((error : any) => {
                console.error("Fehler beim Drucken:", error);
                mymachineryItemState.setCurrentStateByText(mymachineryItemState.possibleStates.NotExecuting.text);

                // Rückgabe an den Client bei Fehler
                const callMethodResult = {
                    statusCode: StatusCodes.BadInternalError,
                    outputArguments: []
                };
                callback(null, callMethodResult);
            });
    });

    setInterval(() => {
        var i;
        var list = jobOrderList.readValue();
        //console.log(list.value.value);
        for (i in list.value.value) {
            var job = (list.value.value[i]);
            //console.log(job.state);
            if (job.state[0].stateNumber == 1) {
                console.log("Change value");
                list.value.value[i].state[0].stateNumber = 2;
                list.value.value[i].state[0].stateText = "AllowedToStart";

            }
        }
        jobOrderList.setValueFromSource(list.value);
    }, 5000); // 10 Sekunden Intervall


    // Endpunkt anzeigen
    console.log("Server is now listening on: ", server.getEndpointUrl());


}

// Führe die Hauptfunktion aus
main().catch((error) => {
    console.error("Error: ", error);
});
