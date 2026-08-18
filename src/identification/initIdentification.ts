import { DataType, LocalizedText, NodeId, NodeIdType, OPCUAServer, UAObject, UAVariable } from "node-opcua";

type ParentNode = UAObject | UAVariable;

function setChildValue(parent: ParentNode, childName: string, value: unknown, dataType: DataType): void {
    const child = parent.getChildByName(childName) as UAVariable;
    if (!child) {
        console.warn(`Child node not found for setting value: ${parent.browseName.toString()}-${childName}`);
        return;
    }

    child.setValueFromSource({
        value,
        dataType
    });
}

interface IdentificationOptions {
    server: OPCUAServer;
    machine: UAObject;
    deviceNamespaceIndex: number;
}

export function initIdentification(options: IdentificationOptions): void {
    const { server, machine, deviceNamespaceIndex } = options;
    const identification = machine.getChildByName("Identification", deviceNamespaceIndex) as UAObject;

    if (!identification) {
        console.warn("Identification node not found. Skipping identification initialization.");
        return;
    }

    setChildValue(identification, "Manufacturer", new LocalizedText("interop4X"), DataType.LocalizedText);
    setChildValue(identification, "ProductInstanceUri", "interop4X.de/choco_cutting_table/123456789", DataType.String);

    const category = server.engine.addressSpace?.constructExtensionObject(
        new NodeId(
            NodeIdType.NUMERIC,
            3014,
            server.engine.addressSpace?.getNamespaceIndex("http://opcfoundation.org/UA/Glass/Flat/v2/")
        ),
        {
            ID: "LabelPrinting",
            Description: "Label printing"
        }
    );

    setChildValue(identification, "ProcessingCategories", category, DataType.ExtensionObject);
    setChildValue(identification, "SerialNumber", "123456789", DataType.String);
    setChildValue(identification, "Model", new LocalizedText("Model 42"), DataType.LocalizedText);
    setChildValue(identification, "SoftwareRevision", "0.4.2", DataType.String);
    setChildValue(identification, "YearOfConstruction", 2024, DataType.UInt16);
    setChildValue(identification, "DeviceClass", "Cutting Table", DataType.String);
    setChildValue(identification, "Location", "ASER B5 224/AMTC B5 224/VIRTUAL 1 1/", DataType.String);
}
