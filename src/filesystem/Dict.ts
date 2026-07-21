import { BaseNode, DataType, OPCUAServer, StatusCodes, UAFileDirectory, Variant } from "node-opcua";
import * as fs from "fs";
import * as path from "path";
import { File } from "./File";
import { FileBaseSystem } from "./FileBaseSystem";

export type FileSystemChild = Dict | File;

export class Dict extends FileBaseSystem {
    public childs: FileSystemChild[] = [];
    public override opcuaObject: UAFileDirectory;

    constructor(protected readonly server: OPCUAServer, name: string, parent: Dict | null, opcuaObject?: BaseNode) {
        super(name, parent);
        if (opcuaObject) {
            this.opcuaObject = opcuaObject as UAFileDirectory;
        } else {
            const type = server.engine.addressSpace?.findObjectType("FileDirectoryType");
            if (!type) {
                throw new Error("FileDirectoryType not found in AddressSpace");
            }
            this.opcuaObject = type.instantiate({
                browseName: name,
                displayName: name,
                organizedBy: parent?.opcuaObject
            }) as UAFileDirectory;
        }
        this.bindMethods();
    }

    public findChild(name: string): FileSystemChild | undefined {
        return this.childs.find((child) => child.name === name);
    }

    public addChild(child: FileSystemChild): void {
        if (!this.findChild(child.name)) {
            this.childs.push(child);
        }
    }

    public addFile(file: File): void {
        this.addChild(file);
    }

    public removeChild(name: string): FileSystemChild | undefined {
        const index = this.childs.findIndex((child) => child.name === name);
        return index < 0 ? undefined : this.childs.splice(index, 1)[0];
    }

    public createDirectory(name: string): Dict {
        this.validateAvailableName(name);
        const target = path.join(this.getFilePath(), name);
        fs.mkdirSync(target);
        try {
            const child = new Dict(this.server, name, this);
            this.addChild(child);
            return child;
        } catch (error) {
            fs.rmdirSync(target);
            throw error;
        }
    }

    public createFile(name: string): File {
        this.validateAvailableName(name);
        const target = path.join(this.getFilePath(), name);
        fs.writeFileSync(target, "", { flag: "wx" });
        try {
            const child = new File(this.server, name, this);
            this.addChild(child);
            return child;
        } catch (error) {
            fs.unlinkSync(target);
            throw error;
        }
    }

    protected loadDirectoryContents(): void {
        for (const entry of fs.readdirSync(this.getFilePath(), { withFileTypes: true })) {
            if (entry.isDirectory()) {
                const child = new Dict(this.server, entry.name, this);
                this.addChild(child);
                child.loadDirectoryContents();
            } else if (entry.isFile()) {
                this.addChild(new File(this.server, entry.name, this));
            }
        }
    }

    private isValidName(name: string): boolean {
        return !!name && name !== "." && name !== ".." && !path.isAbsolute(name) &&
            !name.includes("/") && !name.includes("\\") && !name.includes("\0");
    }

    private validateAvailableName(name: string): void {
        if (!this.isValidName(name)) {
            throw new Error("Invalid file-system child name");
        }
        if (this.findChild(name) || fs.existsSync(path.join(this.getFilePath(), name))) {
            throw new Error("File-system child already exists");
        }
    }

    private bindMethods(): void {
        this.bindCreateDirectory();
        this.bindCreateFile();
    }

    private bindCreateDirectory(): void {
        this.opcuaObject.getMethodByName("CreateDirectory")?.bindMethod((args, _context, callback) => {
            const name = args[0]?.value;
            if (typeof name !== "string" || !this.isValidName(name)) {
                callback(null, { statusCode: StatusCodes.BadInvalidArgument });
                return;
            }
            if (this.findChild(name) || fs.existsSync(path.join(this.getFilePath(), name))) {
                callback(null, { statusCode: StatusCodes.BadBrowseNameDuplicated });
                return;
            }
            try {
                const child = this.createDirectory(name);
                callback(null, {
                    statusCode: StatusCodes.Good,
                    outputArguments: [new Variant({ dataType: DataType.NodeId, value: child.opcuaObject.nodeId })]
                });
            } catch (error) {
                console.error("Could not create directory:", error);
                callback(null, { statusCode: StatusCodes.BadUnexpectedError });
            }
        });
    }

    private bindCreateFile(): void {
        this.opcuaObject.getMethodByName("CreateFile")?.bindMethod((args, context, callback) => {
            const name = args[0]?.value;
            const requestOpen = args[1]?.value;
            if (typeof name !== "string" || !this.isValidName(name) || typeof requestOpen !== "boolean") {
                callback(null, { statusCode: StatusCodes.BadInvalidArgument });
                return;
            }
            if (this.findChild(name) || fs.existsSync(path.join(this.getFilePath(), name))) {
                callback(null, { statusCode: StatusCodes.BadBrowseNameDuplicated });
                return;
            }
            let file: File;
            try {
                file = this.createFile(name);
            } catch (error) {
                console.error("Could not create file:", error);
                callback(null, { statusCode: StatusCodes.BadUnexpectedError });
                return;
            }
            const done = (handle: number) => callback(null, {
                statusCode: StatusCodes.Good,
                outputArguments: [
                    new Variant({ dataType: DataType.NodeId, value: file.opcuaObject.nodeId }),
                    new Variant({ dataType: DataType.UInt32, value: handle })
                ]
            });
            if (!requestOpen) {
                done(0);
                return;
            }
            const openMode = new Variant({ dataType: DataType.Byte, value: 3 });
            file.opcuaObject.open.execute(file.opcuaObject, [openMode], context).then((result) => {
                const statusCode = result.statusCode ?? StatusCodes.BadUnexpectedError;
                if (!statusCode.isGood()) {
                    callback(null, { statusCode });
                    return;
                }
                done(result.outputArguments?.[0]?.value ?? 0);
            }).catch((error) => {
                console.error("Could not open newly created file:", error);
                callback(null, { statusCode: StatusCodes.BadUnexpectedError });
            });
        });
    }
}
