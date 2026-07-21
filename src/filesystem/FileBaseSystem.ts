import { BaseNode } from "node-opcua";
import * as path from "path";
import type { Dict } from "./Dict";

export class FileBaseSystem {
    public parent?: Dict;
    public opcuaObject?: BaseNode;

    constructor(public name: string, parent: Dict | null) {
        this.parent = parent ?? undefined;
    }

    public getFilePath(): string {
        return this.parent ? path.join(this.parent.getFilePath(), this.name) : this.name;
    }
}
