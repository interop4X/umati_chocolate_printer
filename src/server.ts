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
    initIdentification();
    initMachineryItem();
    await InitEnergyMonitoring();

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
                const totalDurationMs = 20 * 1000;
                const prepareDurationMs = Math.floor(totalDurationMs * 0.2);
                const printDurationMs = totalDurationMs - prepareDurationMs;

                jobManagementService.setRunningSubState(jobOrderId, "PreparePrint");
                await SimulateJob(prepareDurationMs);

                jobManagementService.setRunningSubState(jobOrderId, "Print");
                const tempPdfPath = path.join(__dirname, "../data", `${jobOrderId}.pdf`);
                await createPdf(jobOrderId, tempPdfPath, recipePath, source);
                await PrintLabel(tempPdfPath);
                operationCounterManager.incrementCycleCounter();
                lifetimeCounter.increment();
                await SimulateJob(printDurationMs);
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


    function setChildValue(parent: UAObject | UAVariable, childName: string, value: any, dataType: DataType) {
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

    function initIdentification() {
        const identification = machine?.getChildByName("Identification", device_idx) as UAObject;

        if (!identification) {
            console.warn("Identification node not found. Skipping identification initialization.");
            return;
        }

        setChildValue(identification, "Manufacturer", new LocalizedText("interop4X"), DataType.LocalizedText);
        setChildValue(identification, "ProductInstanceUri", "interop4X.de/choco_cutting_table/123456789", DataType.String);

        var Categorie = server.engine.addressSpace?.constructExtensionObject(
            new NodeId(NodeIdType.NUMERIC, 3014, server.engine.addressSpace?.getNamespaceIndex("http://opcfoundation.org/UA/Glass/Flat/v2/")), {
            ID: "LabelPrinting",
            Description: "Label printing"
            }
        );
        setChildValue(identification, "ProcessingCategories", Categorie, DataType.ExtensionObject);
        setChildValue(identification, "SerialNumber", "123456789", DataType.String);
        setChildValue(identification, "Model", new LocalizedText("Model 42"), DataType.LocalizedText);
        setChildValue(identification, "SoftwareRevision", "0.4.2", DataType.String);
        setChildValue(identification, "YearOfConstruction", 2024, DataType.UInt16);
        setChildValue(identification, "DeviceClass", "Cutting Table", DataType.String);
        setChildValue(identification, "Location", "ASER B5 224/AMTC B5 224/VIRTUAL 1 1/", DataType.String);
    }

    // Endpunkt anzeigen
    console.log("Server is now listening on: ", server.getEndpointUrl());

    async function InitEnergyMonitoring() {
        if (!machine) {
            console.warn("Machine instance not available. Skipping energy monitoring initialization.");
            return;
        }

        const monitoringType = server.engine.addressSpace?.findObjectType("MonitoringType", machinery_idx);
        const ecm_idx = server.engine.addressSpace?.getNamespaceIndex("http://opcfoundation.org/UA/ECM/") as number;
        const machineryEnergy_idx = server.engine.addressSpace?.getNamespaceIndex("http://opcfoundation.org/UA/Machinery/Energy/") as number;
        const energyType = server.engine.addressSpace?.findObjectType("IEnergyProfileE1Type", ecm_idx);
        const energyMeasurementType = server.engine.addressSpace?.findObjectType("EnergyMeasurementType", ecm_idx);

        const nonElectricalEnergyType = server.engine.addressSpace?.findObjectType("INonElectricalEnergyType", machineryEnergy_idx);
        const massFlowType = server.engine.addressSpace?.findObjectType("IMassFlowType", machineryEnergy_idx);
        const volumeFlowType = server.engine.addressSpace?.findObjectType("IVolumeFlowType", machineryEnergy_idx);

        if (!monitoringType) {
            console.warn("MonitoringType not found. Skipping monitoring setup.");
            return;
        }

        if (!machineryEnergy_idx) {
            console.warn("Machinery Energy namespace not found. Skipping monitoring setup.");
            return;
        }

        if (!energyType) {
            console.warn("IEnergyProfileE1Type not found. Skipping monitoring setup.");
            return;
        }

        if (!energyMeasurementType) {
            console.warn("EnergyMeasurementType not found. Skipping monitoring setup.");
            return;
        }

        if (!nonElectricalEnergyType || !massFlowType || !volumeFlowType) {
            console.warn("Required Machinery Energy interfaces not found. Skipping monitoring setup.");
            return;
        }

        const monitoring = monitoringType.instantiate({
            componentOf: machine,
            browseName: {
                namespaceIndex: machinery_idx,
                name: "Monitoring"
            },
            optionals: ["Consumption"]
        });

        let consumption = monitoring.getChildByName("Consumption") as UAObject;
        if (!consumption) {
            consumption = myNamespace!.addObject({
                componentOf: monitoring,
                browseName: {
                    namespaceIndex: machinery_idx,
                    name: "Consumption"
                }
            });
        }

        let electricity = consumption.getChildByName("Electricity") as UAObject;
        if (!electricity) {
            electricity = myNamespace!.addObject({
                componentOf: consumption,
                browseName: {
                    namespaceIndex: machineryEnergy_idx,
                    name: "Electricity"
                },
                typeDefinition: "FolderType"
            });
        }

        let compressedAir = consumption.getChildByName("CompressedAir") as UAObject;
        if (!compressedAir) {
            compressedAir = myNamespace!.addObject({
                componentOf: consumption,
                browseName: {
                    namespaceIndex: machineryEnergy_idx,
                    name: "CompressedAir"
                },
                typeDefinition: "FolderType"
            });
        }

        let chilledWater = consumption.getChildByName("ChilledWater") as UAObject;
        if (!chilledWater) {
            chilledWater = myNamespace!.addObject({
                componentOf: consumption,
                browseName: {
                    namespaceIndex: machineryEnergy_idx,
                    name: "ChilledWater"
                },
                typeDefinition: "FolderType"
            });
        }

        const myEnergyProfileE1Type = myNamespace?.addObjectType({
            browseName: "EnergyProfileE1Type",
            subtypeOf: energyType!,
        });

        const compressedAirMeasurementType = myNamespace?.addObjectType({
            browseName: "CompressedAirMeasurementType",
            subtypeOf: energyMeasurementType,
        });

        const chilledWaterMeasurementType = myNamespace?.addObjectType({
            browseName: "ChilledWaterMeasurementType",
            subtypeOf: energyMeasurementType,
        });

        if (!myEnergyProfileE1Type || !compressedAirMeasurementType || !chilledWaterMeasurementType) {
            console.warn("Failed to create measurement subtypes.");
            return;
        }

        compressedAirMeasurementType.addReference({ referenceType: "HasInterface", nodeId: nonElectricalEnergyType.nodeId });
        compressedAirMeasurementType.addReference({ referenceType: "HasInterface", nodeId: massFlowType.nodeId });
        compressedAirMeasurementType.addReference({ referenceType: "HasInterface", nodeId: volumeFlowType.nodeId });

        chilledWaterMeasurementType.addReference({ referenceType: "HasInterface", nodeId: volumeFlowType.nodeId });
    
        const energy_bb = myEnergyProfileE1Type.instantiate({
            componentOf: electricity,
            browseName: {
                namespaceIndex: machineryEnergy_idx,
                name: "Main"
            }
        });

        const compressedAirMain = compressedAirMeasurementType.instantiate({
            componentOf: compressedAir,
            browseName: {
                namespaceIndex: machineryEnergy_idx,
                name: "Main"
            },
            optionals: ["Pressure", "Temperature", "VolumeFlowRate", "Volume"]
        });

        const chilledWaterMain = chilledWaterMeasurementType.instantiate({
            componentOf: chilledWater,
            browseName: {
                namespaceIndex: machineryEnergy_idx,
                name: "Main"
            },
            optionals: ["Pressure", "Temperature", "VolumeFlowRate", "Volume"]
        });

        function ensureFloatVariable(parent: UAObject, variableName: string, initialValue: number) {
            let node = parent.getChildByName(variableName, ecm_idx) as UAVariable;
            if (!node) {
                node = myNamespace!.addVariable({
                    componentOf: parent,
                    browseName: {
                        namespaceIndex: ecm_idx,
                        name: variableName
                    },
                    dataType: DataType.Float
                });
            }

            node.setValueFromSource({ value: initialValue, dataType: DataType.Float });
            return node;
        }

        function setEngineeringUnits(variable: UAVariable, unitId: number, displayName: string, description: string) {
            let engineeringUnitsNode = variable.getChildByName("EngineeringUnits") as UAVariable;
            if (!engineeringUnitsNode) {
                engineeringUnitsNode = myNamespace!.addVariable({
                    propertyOf: variable,
                    browseName: "EngineeringUnits",
                    dataType: "EUInformation"
                });
            }

            const euInfo = new EUInformation({
                namespaceUri: "http://www.opcfoundation.org/UA/units/un/cefact",
                unitId,
                displayName: new LocalizedText(displayName),
                description: new LocalizedText(description)
            });

            engineeringUnitsNode.setValueFromSource({
                value: euInfo,
                dataType: DataType.ExtensionObject
            });
        }

        const compressedAirPressureNode = ensureFloatVariable(compressedAirMain, "Pressure", 650000);
        const compressedAirTemperatureNode = ensureFloatVariable(compressedAirMain, "Temperature", 20.0);
        const compressedAirFlowRateNode = ensureFloatVariable(compressedAirMain, "VolumeFlowRate", 0.012);
        const compressedAirVolumeNode = ensureFloatVariable(compressedAirMain, "Volume", 0);

        const chilledWaterPressureNode = ensureFloatVariable(chilledWaterMain, "Pressure", 280000);
        const chilledWaterTemperatureNode = ensureFloatVariable(chilledWaterMain, "Temperature", 4.0);
        const chilledWaterFlowRateNode = ensureFloatVariable(chilledWaterMain, "VolumeFlowRate", 0.004);
        const chilledWaterVolumeNode = ensureFloatVariable(chilledWaterMain, "Volume", 0);

        // Units: Pressure [Pa], Temperature [degC], VolumeFlowRate [m^3/s], Volume [m^3]
        for (const pressureNode of [compressedAirPressureNode, chilledWaterPressureNode]) {
            setEngineeringUnits(pressureNode, 5259596, "Pa", "pascal");
        }
        for (const temperatureNode of [compressedAirTemperatureNode, chilledWaterTemperatureNode]) {
            setEngineeringUnits(temperatureNode, 4408652, "degC", "degree Celsius");
        }
        for (const flowRateNode of [compressedAirFlowRateNode, chilledWaterFlowRateNode]) {
            setEngineeringUnits(flowRateNode, 5067091, "m3/s", "cubic metre per second");
        }
        for (const volumeNode of [compressedAirVolumeNode, chilledWaterVolumeNode]) {
            setEngineeringUnits(volumeNode, 5067857, "m3", "cubic metre");
        }

        const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
        const randomDelta = (amplitude: number) => (Math.random() * 2 - 1) * amplitude;

        let compressedAirPressure = 650000;
        let compressedAirTemperature = 20.0;
        let compressedAirFlowRate = 0.012;
        let compressedAirVolume = 0;

        let chilledWaterPressure = 280000;
        let chilledWaterTemperature = 4.0;
        let chilledWaterFlowRate = 0.004;
        let chilledWaterVolume = 0;

        // Simuliere realistische Schwankungen und integriere VolumeFlowRate zu Volume (m^3).
        setInterval(() => {
            const dtSeconds = 1;

            compressedAirTemperature = clamp(
                compressedAirTemperature + (20.0 - compressedAirTemperature) * 0.08 + randomDelta(0.08),
                18.5,
                22.0
            );
            compressedAirPressure = clamp(
                compressedAirPressure + (650000 - compressedAirPressure) * 0.08 + randomDelta(5000),
                550000,
                720000
            );
            compressedAirFlowRate = clamp(
                compressedAirFlowRate + (0.012 - compressedAirFlowRate) * 0.12 + randomDelta(0.0018),
                0.006,
                0.022
            );
            compressedAirVolume += compressedAirFlowRate * dtSeconds;

            chilledWaterTemperature = clamp(
                chilledWaterTemperature + (4.0 - chilledWaterTemperature) * 0.1 + randomDelta(0.05),
                3.2,
                5.2
            );
            chilledWaterPressure = clamp(
                chilledWaterPressure + (280000 - chilledWaterPressure) * 0.1 + randomDelta(4000),
                210000,
                340000
            );
            chilledWaterFlowRate = clamp(
                chilledWaterFlowRate + (0.004 - chilledWaterFlowRate) * 0.14 + randomDelta(0.0008),
                0.0015,
                0.008
            );
            chilledWaterVolume += chilledWaterFlowRate * dtSeconds;

            compressedAirPressureNode.setValueFromSource({ value: compressedAirPressure, dataType: DataType.Float });
            compressedAirTemperatureNode.setValueFromSource({ value: compressedAirTemperature, dataType: DataType.Float });
            compressedAirFlowRateNode.setValueFromSource({ value: compressedAirFlowRate, dataType: DataType.Float });
            compressedAirVolumeNode.setValueFromSource({ value: compressedAirVolume, dataType: DataType.Float });

            chilledWaterPressureNode.setValueFromSource({ value: chilledWaterPressure, dataType: DataType.Float });
            chilledWaterTemperatureNode.setValueFromSource({ value: chilledWaterTemperature, dataType: DataType.Float });
            chilledWaterFlowRateNode.setValueFromSource({ value: chilledWaterFlowRate, dataType: DataType.Float });
            chilledWaterVolumeNode.setValueFromSource({ value: chilledWaterVolume, dataType: DataType.Float });
        }, 1000);

        const compressedAirPowerNode = compressedAirMain.getChildByName("NeEnergyImportHp") as UAVariable;
        if (compressedAirPowerNode) {
            compressedAirPowerNode.setValueFromSource({ value: 0, dataType: DataType.Double });
        }

        const power_node = energy_bb?.getChildByName("AcActivePowerTotal") as UAVariable;
        if (!power_node) {
            console.warn("AcActivePowerTotal not found under Monitoring.Consumption.Electricity.Main.");
            return;
        }

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
