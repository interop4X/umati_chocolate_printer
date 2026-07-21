import { DataType, OPCUAServer, QualifiedName, UAObject, UAVariable } from "node-opcua";
import { CounterStore } from "../persistence/CounterStore";

export class LifetimeCounter {
    public readonly variable: UAVariable;

    constructor(
        server: OPCUAServer,
        buildingBlocks: UAObject,
        machineryNamespaceIndex: number,
        deviceNamespaceIndex: number,
        private readonly store: CounterStore
    ) {
        const addressSpace = server.engine.addressSpace;
        const folderType = addressSpace?.findObjectType("MachineryLifetimeCounterType", machineryNamespaceIndex);
        const variableType = addressSpace?.findVariableType("LifetimeVariableType", deviceNamespaceIndex);
        if (!folderType || !variableType) {
            throw new Error("Lifetime counter types not found in AddressSpace");
        }

        const folder = folderType.instantiate({
            organizedBy: buildingBlocks,
            browseName: new QualifiedName({
                namespaceIndex: machineryNamespaceIndex,
                name: "LifetimeCounters"
            })
        });
        this.variable = variableType.instantiate({
            organizedBy: folder,
            browseName: new QualifiedName({
                namespaceIndex: machineryNamespaceIndex,
                name: "Paper"
            }),
            optionals: ["Indication"]
        });

        this.variable.setValueFromSource({
            value: this.store.load().lifetimeCounter,
            dataType: DataType.UInt32
        });
        this.setChildValue("StartValue", 0);
        this.setChildValue("LimitValue", 500);
    }

    public increment(): number {
        const currentValue = this.variable.readValue().value.value ?? 0;
        const newValue = Math.min(currentValue + 1, 0xFFFFFFFF);
        this.variable.setValueFromSource({ value: newValue, dataType: DataType.UInt32 });
        this.store.update({ lifetimeCounter: newValue });
        return newValue;
    }

    private setChildValue(childName: string, value: number): void {
        const child = this.variable.getChildByName(childName) as UAVariable | null;
        if (!child) {
            throw new Error(`Lifetime counter child ${childName} not found`);
        }
        child.setValueFromSource({ value, dataType: DataType.UInt32 });
    }
}
