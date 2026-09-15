import { DataType, LocalizedText, OPCUAServer, UAObject, UAVariable } from "node-opcua";
import { EUInformation } from "node-opcua-data-access";
import { ShellyPlugClient } from "../ShellyPlugClient";

interface EnergyMonitoringOptions {
    server: OPCUAServer;
    machineryBuildingBlocks: UAObject;
    myNamespace: any;
    machineryNamespaceIndex: number;
}

function ensureFloatVariable(parent: UAObject, variableName: string, namespaceIndex: number, myNamespace: any, initialValue: number): UAVariable {
    let node = parent.getChildByName(variableName, namespaceIndex) as UAVariable;
    if (!node) {
        node = myNamespace.addVariable({
            componentOf: parent,
            browseName: {
                namespaceIndex,
                name: variableName
            },
            dataType: DataType.Float
        });
    }

    node.setValueFromSource({ value: initialValue, dataType: DataType.Float });
    return node;
}

function setEngineeringUnits(variable: UAVariable, unitId: number, displayName: string, description: string, myNamespace: any): void {
    let engineeringUnitsNode = variable.getChildByName("EngineeringUnits") as UAVariable;
    if (!engineeringUnitsNode) {
        engineeringUnitsNode = myNamespace.addVariable({
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

export async function initEnergyMonitoring(options: EnergyMonitoringOptions): Promise<void> {
    const { server, machineryBuildingBlocks, myNamespace, machineryNamespaceIndex } = options;

    const monitoringType = server.engine.addressSpace?.findObjectType("MonitoringType", machineryNamespaceIndex);
    const ecmNamespaceIndex = server.engine.addressSpace?.getNamespaceIndex("http://opcfoundation.org/UA/ECM/") as number;
    const machineryEnergyNamespaceIndex = server.engine.addressSpace?.getNamespaceIndex("http://opcfoundation.org/UA/Machinery/Energy/") as number;
    const energyType = server.engine.addressSpace?.findObjectType("IEnergyProfileE1Type", ecmNamespaceIndex);
    const energyMeasurementType = server.engine.addressSpace?.findObjectType("EnergyMeasurementType", ecmNamespaceIndex);

    const nonElectricalEnergyType = server.engine.addressSpace?.findObjectType("INonElectricalEnergyType", machineryEnergyNamespaceIndex);
    const massFlowType = server.engine.addressSpace?.findObjectType("IMassFlowType", machineryEnergyNamespaceIndex);
    const volumeFlowType = server.engine.addressSpace?.findObjectType("IVolumeFlowType", machineryEnergyNamespaceIndex);

    if (!monitoringType) {
        console.warn("MonitoringType not found. Skipping monitoring setup.");
        return;
    }

    if (!machineryEnergyNamespaceIndex) {
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

    // The machine type already provides a Monitoring node, so reuse it instead of creating a second one.
    let monitoring = machineryBuildingBlocks.getChildByName("Monitoring", machineryNamespaceIndex) as UAObject;
    if (!monitoring) {
        monitoring = monitoringType.instantiate({
            componentOf: machineryBuildingBlocks,
            browseName: {
                namespaceIndex: machineryNamespaceIndex,
                name: "Monitoring"
            },
            namespace: myNamespace,
            optionals: ["Consumption"]
        });
    }

    let consumption = monitoring.getChildByName("Consumption", machineryNamespaceIndex) as UAObject;
    if (!consumption) {
        consumption = myNamespace.addObject({
            componentOf: monitoring,
            browseName: {
                namespaceIndex: machineryNamespaceIndex,
                name: "Consumption"
            }
        });
    }

    let electricity = consumption.getChildByName("Electricity") as UAObject;
    if (!electricity) {
        electricity = myNamespace.addObject({
            componentOf: consumption,
            browseName: {
                namespaceIndex: machineryEnergyNamespaceIndex,
                name: "Electricity"
            },
            typeDefinition: "FolderType"
        });
    }

    let compressedAir = consumption.getChildByName("CompressedAir") as UAObject;
    if (!compressedAir) {
        compressedAir = myNamespace.addObject({
            componentOf: consumption,
            browseName: {
                namespaceIndex: machineryEnergyNamespaceIndex,
                name: "CompressedAir"
            },
            typeDefinition: "FolderType"
        });
    }

    let chilledWater = consumption.getChildByName("ChilledWater") as UAObject;
    if (!chilledWater) {
        chilledWater = myNamespace.addObject({
            componentOf: consumption,
            browseName: {
                namespaceIndex: machineryEnergyNamespaceIndex,
                name: "ChilledWater"
            },
            typeDefinition: "FolderType"
        });
    }

    const myEnergyProfileE1Type = myNamespace.addObjectType({
        browseName: "EnergyProfileE1Type",
        subtypeOf: energyType
    });

    const compressedAirMeasurementType = myNamespace.addObjectType({
        browseName: "CompressedAirMeasurementType",
        subtypeOf: energyMeasurementType
    });

    const chilledWaterMeasurementType = myNamespace.addObjectType({
        browseName: "ChilledWaterMeasurementType",
        subtypeOf: energyMeasurementType
    });

    compressedAirMeasurementType.addReference({ referenceType: "HasInterface", nodeId: nonElectricalEnergyType.nodeId });
    compressedAirMeasurementType.addReference({ referenceType: "HasInterface", nodeId: massFlowType.nodeId });
    compressedAirMeasurementType.addReference({ referenceType: "HasInterface", nodeId: volumeFlowType.nodeId });

    chilledWaterMeasurementType.addReference({ referenceType: "HasInterface", nodeId: volumeFlowType.nodeId });

    // The machine type already provides the richer Electricity/Main (import, export and power), so reuse it.
    let electricityMain = electricity.getChildByName("Main", machineryEnergyNamespaceIndex) as UAObject;
    if (!electricityMain) {
        electricityMain = myEnergyProfileE1Type.instantiate({
            componentOf: electricity,
            browseName: {
                namespaceIndex: machineryEnergyNamespaceIndex,
                name: "Main"
            },
            namespace: myNamespace
        });
    }

    const compressedAirMain = compressedAirMeasurementType.instantiate({
        componentOf: compressedAir,
        browseName: {
            namespaceIndex: machineryEnergyNamespaceIndex,
            name: "Main"
        },
        namespace: myNamespace,
        optionals: ["Pressure", "Temperature", "VolumeFlowRate", "Volume"]
    });

    const chilledWaterMain = chilledWaterMeasurementType.instantiate({
        componentOf: chilledWater,
        browseName: {
            namespaceIndex: machineryEnergyNamespaceIndex,
            name: "Main"
        },
        namespace: myNamespace,
        optionals: ["Pressure", "Temperature", "VolumeFlowRate", "Volume"]
    });

    const compressedAirPressureNode = ensureFloatVariable(compressedAirMain, "Pressure", ecmNamespaceIndex, myNamespace, 650000);
    const compressedAirTemperatureNode = ensureFloatVariable(compressedAirMain, "Temperature", ecmNamespaceIndex, myNamespace, 20.0);
    const compressedAirFlowRateNode = ensureFloatVariable(compressedAirMain, "VolumeFlowRate", ecmNamespaceIndex, myNamespace, 0.012);
    const compressedAirVolumeNode = ensureFloatVariable(compressedAirMain, "Volume", ecmNamespaceIndex, myNamespace, 0);

    const chilledWaterPressureNode = ensureFloatVariable(chilledWaterMain, "Pressure", ecmNamespaceIndex, myNamespace, 280000);
    const chilledWaterTemperatureNode = ensureFloatVariable(chilledWaterMain, "Temperature", ecmNamespaceIndex, myNamespace, 4.0);
    const chilledWaterFlowRateNode = ensureFloatVariable(chilledWaterMain, "VolumeFlowRate", ecmNamespaceIndex, myNamespace, 0.004);
    const chilledWaterVolumeNode = ensureFloatVariable(chilledWaterMain, "Volume", ecmNamespaceIndex, myNamespace, 0);

    for (const pressureNode of [compressedAirPressureNode, chilledWaterPressureNode]) {
        setEngineeringUnits(pressureNode, 5259596, "Pa", "pascal", myNamespace);
    }
    for (const temperatureNode of [compressedAirTemperatureNode, chilledWaterTemperatureNode]) {
        setEngineeringUnits(temperatureNode, 4408652, "degC", "degree Celsius", myNamespace);
    }
    for (const flowRateNode of [compressedAirFlowRateNode, chilledWaterFlowRateNode]) {
        setEngineeringUnits(flowRateNode, 5067091, "m3/s", "cubic metre per second", myNamespace);
    }
    for (const volumeNode of [compressedAirVolumeNode, chilledWaterVolumeNode]) {
        setEngineeringUnits(volumeNode, 5067857, "m3", "cubic metre", myNamespace);
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

    // Simulate realistic fluctuations and integrate flow rate to total volume.
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

    const powerNode = electricityMain.getChildByName("AcActivePowerTotal") as UAVariable;
    if (!powerNode) {
        console.warn("AcActivePowerTotal not found under Monitoring.Consumption.Electricity.Main.");
        return;
    }

    const energyImportNode = electricityMain.getChildByName("AcActiveEnergyTotalImportLp") as UAVariable;
    const energyExportNode = electricityMain.getChildByName("AcActiveEnergyTotalExportLp") as UAVariable;
    // ECM defines AcActivePowerTotal in W and the energy odometers in Wh.
    let energyImportWh = 0;
    energyImportNode?.setValueFromSource({ value: energyImportWh, dataType: DataType.Float });
    // The machine never feeds back into the grid.
    energyExportNode?.setValueFromSource({ value: 0, dataType: DataType.Float });

    const shelly = new ShellyPlugClient("192.168.33.1");
    let shellyAvailable = false;
    try {
        shellyAvailable = await shelly.setPowerOn();
        if (shellyAvailable) {
            console.log("Shelly Plug eingeschaltet");
        } else {
            console.error("Fehler beim Einschalten des Shelly Plugs");
        }
    } catch (error) {
        console.error("Fehler beim Einschalten des Shelly Plugs:", error);
    }

    // Fallback while the plug delivers no reading: simulate a plausible standby/load power.
    let simulatedPower = 45;
    const simulatePower = () => {
        simulatedPower = clamp(
            simulatedPower + (45 - simulatedPower) * 0.1 + randomDelta(6),
            18,
            120
        );
        return simulatedPower;
    };

    const samplingIntervalMs = 500;
    let lastSample = Date.now();
    setInterval(async () => {
        const measuredPower = shellyAvailable ? await shelly.getActivePower() : null;
        const power = typeof measuredPower === "number" ? measuredPower : simulatePower();
        powerNode.setValueFromSource({
            value: power,
            dataType: DataType.Float
        });

        const now = Date.now();
        const elapsedHours = (now - lastSample) / 3_600_000;
        lastSample = now;
        if (energyImportNode && power > 0) {
            energyImportWh += power * elapsedHours;
            energyImportNode.setValueFromSource({ value: energyImportWh, dataType: DataType.Float });
        }
    }, samplingIntervalMs);
}
