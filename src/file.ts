import { OPCUAServer, UAFile, UAObjectType, BaseNode, UAFileDirectory } from "node-opcua";
import { installFileType } from "node-opcua-file-transfer";
const fs = require("fs");
const js_path = require("path");
const chokidar = require('chokidar');

export class FileBaseSystem {
    public parent?: FileBaseSystem;
    public name: string;
    public opcuaObject?: BaseNode;

    constructor(name: string, parent: FileBaseSystem | null) {
        this.parent = parent ?? undefined;
        this.name = name;
        this.opcuaObject = undefined; // Ensure BaseNode initialization
    }

    public getFilePath(): string {
        return this.parent ? `${this.parent.getFilePath()}/${this.name}` : this.name;
    }
}
export class Dict extends FileBaseSystem {

    public childs: File[] = [];

    constructor(name: string, parent: FileBaseSystem | null) {
        super(name, parent);
    }

    public override getFilePath(): string {
        return this.name; // Root directory returns just its name as the file path
    }

    public addFile(file: File) {
        this.childs.push(file);
    }
}

export class RootDict extends Dict {

    constructor(server: OPCUAServer, path: string, opcuaObject: BaseNode) {
        super(path, null); // Root has no parent
        this.opcuaObject = opcuaObject;
        const watcher = chokidar.watch(path, {
            persistent: true,
            ignoreInitial: false,  // Ignoriert vorhandene Dateien beim Start
        });

        watcher.on('add', (path: any) => {
            console.log(`Datei ${path} wurde hinzugefügt`);
            this.addFile(new File(server, js_path.basename(path), this));
        });

        // Ereignis für das Ändern einer Datei
        watcher.on('change', (path: any) => {
            console.log(`Datei ${path} wurde geändert`);
        });

        // Ereignis für das Entfernen einer Datei
        watcher.on('unlink', (path: any) => {
            console.log(`Datei ${path} wurde gelöscht`);
        });

        // Ereignis für das Hinzufügen eines Verzeichnisses
        watcher.on('addDir', (path: any) => {
            console.log(`Verzeichnis ${path} wurde hinzugefügt`);
        });

        // Ereignis für das Entfernen eines Verzeichnisses
        watcher.on('unlinkDir', (path: any) => {
            console.log(`Verzeichnis ${path} wurde gelöscht`);
        });

    }

    public override getFilePath(): string {
        return this.name; // Root directory returns just its name as the file path
    }
}

export class File extends FileBaseSystem {
    private fileType: UAObjectType;
    public override opcuaObject: UAFile;

    constructor(server: OPCUAServer, name: string, parent: FileBaseSystem) {
        super(name, parent);

        // Find the "FileType" in the OPC UA AddressSpace
        this.fileType = server.engine.addressSpace?.findObjectType("FileType")!;
        if (!this.fileType) {
            throw new Error("FileType not found in AddressSpace");
        }

        // Instantiate the file object in the OPC UA model
        this.opcuaObject = this.fileType.instantiate({
            //nodeId: `s=${name}`, // Dynamic name for the NodeId
            browseName: name,     // Dynamic browse name
            organizedBy: this.parent?.opcuaObject  // Organized by the parent OPC UA object
        }) as UAFile;

        if (!fs.existsSync(this.getFilePath())) {
            // Falls die Datei nicht existiert, wird sie erstellt
            fs.writeFileSync(this.getFilePath(), "", { flag: "w" }); // Leere Datei anlegen
            console.log(`Datei wurde erstellt: ${this.getFilePath()}`);
        }

        // Install the file handler for reading/writing to the file system
        installFileType(this.opcuaObject, {
            filename: this.getFilePath(),
        });
    }
}