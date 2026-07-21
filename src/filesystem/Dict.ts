import {
    BaseNode, DataType, NodeId, OPCUAServer, sameNodeId, StatusCodes,
    UAFileDirectory, Variant
} from "node-opcua";
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
        this.ensureNodeVersion();
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
            let child!: Dict;
            this.runModelChangeTransaction(() => {
                child = new Dict(this.server, name, this);
            });
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
            let child!: File;
            this.runModelChangeTransaction(() => {
                child = new File(this.server, name, this);
            });
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

    public getRoot(): Dict {
        let current: Dict = this;
        while (current.parent) {
            current = current.parent;
        }
        return current;
    }

    public findByNodeId(nodeId: NodeId): FileSystemChild | undefined {
        if (sameNodeId(this.opcuaObject.nodeId, nodeId)) {
            return this;
        }
        for (const child of this.childs) {
            if (sameNodeId(child.opcuaObject!.nodeId, nodeId)) {
                return child;
            }
            if (child instanceof Dict) {
                const match = child.findByNodeId(nodeId);
                if (match) {
                    return match;
                }
            }
        }
        return undefined;
    }

    public isLocked(): boolean {
        return this.childs.some((child) => {
            if (child instanceof Dict) {
                return child.isLocked();
            }
            const openCount = child.opcuaObject.openCount.readValue().value.value;
            return typeof openCount === "number" && openCount > 0;
        });
    }

    protected addExistingEntry(name: string): FileSystemChild {
        const entryPath = path.join(this.getFilePath(), name);
        const stat = fs.statSync(entryPath);
        if (stat.isDirectory()) {
            const child = new Dict(this.server, name, this);
            this.addChild(child);
            child.loadDirectoryContents();
            return child;
        }
        if (stat.isFile()) {
            const child = new File(this.server, name, this);
            this.addChild(child);
            return child;
        }
        throw new Error("Unsupported file-system entry");
    }

    public deleteAddressSpaceChild(child: FileSystemChild): void {
        this.removeChild(child.name);
        if (!child.opcuaObject?.isDisposed()) {
            child.opcuaObject!.namespace.deleteNode(child.opcuaObject!);
        }
    }

    protected runModelChangeTransaction(action: () => void): void {
        const addressSpace = this.server.engine.addressSpace as unknown as {
            modelChangeTransaction(callback: () => void): void;
        };
        addressSpace.modelChangeTransaction(action);
    }

    private ensureNodeVersion(): void {
        if (this.opcuaObject.getChildByName("NodeVersion", 0)) {
            return;
        }
        const nodeVersion = this.opcuaObject.namespace.addVariable({
            browseName: { name: "NodeVersion", namespaceIndex: 0 },
            dataType: DataType.String,
            propertyOf: this.opcuaObject
        });
        nodeVersion.setValueFromSource({ dataType: DataType.String, value: "0" });
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
        this.bindDelete();
        this.bindMoveOrCopy();
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

    private bindDelete(): void {
        this.opcuaObject.getMethodByName("Delete")?.bindMethod((args, _context, callback) => {
            const nodeId = args[0]?.value;
            if (!(nodeId instanceof NodeId)) {
                callback(null, { statusCode: StatusCodes.BadInvalidArgument });
                return;
            }
            const child = this.childs.find((candidate) => sameNodeId(candidate.opcuaObject!.nodeId, nodeId));
            if (!child) {
                callback(null, { statusCode: StatusCodes.BadNotFound });
                return;
            }
            if (this.childIsLocked(child)) {
                callback(null, { statusCode: StatusCodes.BadInvalidState });
                return;
            }
            try {
                fs.rmSync(child.getFilePath(), { recursive: child instanceof Dict });
                this.runModelChangeTransaction(() => {
                    this.deleteAddressSpaceChild(child);
                });
                callback(null, { statusCode: StatusCodes.Good });
            } catch (error) {
                console.error("Could not delete file-system entry:", error);
                callback(null, { statusCode: StatusCodes.BadUnexpectedError });
            }
        });
    }

    private bindMoveOrCopy(): void {
        this.opcuaObject.getMethodByName("MoveOrCopy")?.bindMethod((args, _context, callback) => {
            const sourceNodeId = args[0]?.value;
            const targetNodeId = args[1]?.value;
            const createCopy = args[2]?.value;
            const requestedName = args[3]?.value;
            if (!(sourceNodeId instanceof NodeId) || !(targetNodeId instanceof NodeId) ||
                typeof createCopy !== "boolean" || typeof requestedName !== "string") {
                callback(null, { statusCode: StatusCodes.BadInvalidArgument });
                return;
            }

            const source = this.childs.find((candidate) => sameNodeId(candidate.opcuaObject!.nodeId, sourceNodeId));
            const target = this.getRoot().findByNodeId(targetNodeId);
            if (!source || !(target instanceof Dict)) {
                callback(null, { statusCode: StatusCodes.BadNotFound });
                return;
            }
            if (this.childIsLocked(source)) {
                callback(null, { statusCode: StatusCodes.BadInvalidState });
                return;
            }

            const targetName = requestedName || source.name;
            if (!this.isValidName(targetName) || this.isCyclicDirectoryTarget(source, target)) {
                callback(null, { statusCode: StatusCodes.BadInvalidArgument });
                return;
            }
            if (!createCopy && target === this && targetName === source.name) {
                callback(null, {
                    statusCode: StatusCodes.Good,
                    outputArguments: [new Variant({ dataType: DataType.NodeId, value: source.opcuaObject!.nodeId })]
                });
                return;
            }
            if (target.findChild(targetName) || fs.existsSync(path.join(target.getFilePath(), targetName))) {
                callback(null, { statusCode: StatusCodes.BadBrowseNameDuplicated });
                return;
            }

            const sourcePath = source.getFilePath();
            const targetPath = path.join(target.getFilePath(), targetName);
            let created: FileSystemChild | undefined;
            try {
                if (createCopy) {
                    if (source instanceof Dict) {
                        fs.cpSync(sourcePath, targetPath, { recursive: true, errorOnExist: true, force: false });
                    } else {
                        fs.copyFileSync(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
                    }
                } else {
                    fs.renameSync(sourcePath, targetPath);
                }

                this.runModelChangeTransaction(() => {
                    created = target.addExistingEntry(targetName);
                    if (!createCopy) {
                        this.deleteAddressSpaceChild(source);
                    }
                });
                callback(null, {
                    statusCode: StatusCodes.Good,
                    outputArguments: [new Variant({ dataType: DataType.NodeId, value: created!.opcuaObject!.nodeId })]
                });
            } catch (error) {
                this.rollbackMoveOrCopy(sourcePath, targetPath, createCopy, target, created);
                console.error("Could not move or copy file-system entry:", error);
                callback(null, { statusCode: StatusCodes.BadUnexpectedError });
            }
        });
    }

    private childIsLocked(child: FileSystemChild): boolean {
        if (child instanceof Dict) {
            return child.isLocked();
        }
        const openCount = child.opcuaObject.openCount.readValue().value.value;
        return typeof openCount === "number" && openCount > 0;
    }

    private isCyclicDirectoryTarget(source: FileSystemChild, target: Dict): boolean {
        if (!(source instanceof Dict)) {
            return false;
        }
        let current: Dict | undefined = target;
        while (current) {
            if (current === source) {
                return true;
            }
            current = current.parent;
        }
        return false;
    }

    private rollbackMoveOrCopy(
        sourcePath: string,
        targetPath: string,
        createCopy: boolean,
        target: Dict,
        created?: FileSystemChild
    ): void {
        try {
            if (created) {
                target.deleteAddressSpaceChild(created);
            }
            if (createCopy) {
                if (fs.existsSync(targetPath)) {
                    fs.rmSync(targetPath, { recursive: true });
                }
            } else if (fs.existsSync(targetPath) && !fs.existsSync(sourcePath)) {
                fs.renameSync(targetPath, sourcePath);
            }
        } catch (rollbackError) {
            console.error("Could not roll back file-system operation:", rollbackError);
        }
    }
}
