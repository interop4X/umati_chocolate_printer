import { BaseNode, Namespace, OPCUAServer } from "node-opcua";
import * as fs from "fs";
import * as path from "path";
import chokidar, { FSWatcher } from "chokidar";
import { Dict } from "./Dict";
import { File } from "./File";

export class RootDict extends Dict {
    private readonly watcher: FSWatcher;

    constructor(server: OPCUAServer, rootPath: string, opcuaObject: BaseNode, namespace?: Namespace) {
        const absoluteRoot = path.resolve(rootPath);
        fs.mkdirSync(absoluteRoot, { recursive: true });
        super(server, absoluteRoot, null, opcuaObject);
        this.loadDirectoryContents();
        this.watcher = chokidar.watch(absoluteRoot, { persistent: true, ignoreInitial: true });
        this.watcher.on("add", (entry) => this.fileAdded(entry));
        this.watcher.on("addDir", (entry) => this.directoryAdded(entry));
        this.watcher.on("unlink", (entry) => this.entryRemoved(entry));
        this.watcher.on("unlinkDir", (entry) => this.entryRemoved(entry));
    }

    private relativeParts(entryPath: string): string[] | undefined {
        const relative = path.relative(this.getFilePath(), path.resolve(entryPath));
        if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
            return undefined;
        }
        return relative.split(path.sep).filter(Boolean);
    }

    private findDirectory(parts: string[], createMissing: boolean): Dict | undefined {
        let directory: Dict = this;
        for (const part of parts) {
            const child = directory.findChild(part);
            if (child instanceof Dict) {
                directory = child;
                continue;
            }
            if (child || !createMissing) {
                return undefined;
            }
            const childPath = path.join(directory.getFilePath(), part);
            if (!fs.existsSync(childPath) || !fs.statSync(childPath).isDirectory()) {
                return undefined;
            }
            const newDirectory = new Dict(this.server, part, directory);
            directory.addChild(newDirectory);
            directory = newDirectory;
        }
        return directory;
    }

    private directoryAdded(entryPath: string): void {
        const parts = this.relativeParts(entryPath);
        if (parts) {
            this.runModelChangeTransaction(() => {
                this.findDirectory(parts, true);
            });
        }
    }

    private fileAdded(entryPath: string): void {
        const parts = this.relativeParts(entryPath);
        if (!parts?.length) {
            return;
        }
        const name = parts.pop()!;
        this.runModelChangeTransaction(() => {
            const parent = this.findDirectory(parts, true);
            if (parent && !parent.findChild(name)) {
                parent.addChild(new File(this.server, name, parent));
            }
        });
    }

    private entryRemoved(entryPath: string): void {
        const parts = this.relativeParts(entryPath);
        if (!parts?.length) {
            return;
        }
        const name = parts.pop()!;
        const parent = this.findDirectory(parts, false);
        const removed = parent?.findChild(name);
        if (!parent || !removed) {
            return;
        }
        this.runModelChangeTransaction(() => {
            parent.deleteAddressSpaceChild(removed);
        });
    }
}
