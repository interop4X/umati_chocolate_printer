import { OPCUAServer, UAFile, UAObjectType } from "node-opcua";
import { installFileType } from "node-opcua-file-transfer";
import type { Dict } from "./Dict";
import { FileBaseSystem } from "./FileBaseSystem";

export class File extends FileBaseSystem {
    private readonly fileType: UAObjectType;
    public override opcuaObject: UAFile;

    constructor(server: OPCUAServer, name: string, parent: Dict) {
        super(name, parent);
        this.fileType = server.engine.addressSpace?.findObjectType("FileType")!;
        if (!this.fileType) {
            throw new Error("FileType not found in AddressSpace");
        }
        this.opcuaObject = this.fileType.instantiate({
            browseName: name,
            displayName: name,
            organizedBy: parent.opcuaObject,
            namespace: parent.targetNamespace
        }) as UAFile;
        try {
            installFileType(this.opcuaObject, { filename: this.getFilePath() });
        } catch (error) {
            this.opcuaObject.namespace.deleteNode(this.opcuaObject);
            throw error;
        }
    }
}
