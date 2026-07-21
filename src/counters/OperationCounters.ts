import { BaseNode, DataType, UAVariable } from "node-opcua";
import { CounterStore } from "../persistence/CounterStore";

export class OperationCounters {
    private readonly cycleCounter: UAVariable;
    private readonly operationDuration: UAVariable;
    private readonly powerOnDuration: UAVariable;
    private readonly powerOnTimer: NodeJS.Timeout;
    private lastPowerOnUpdate = Date.now();
    private disposed = false;
    private readonly exitHandler = () => {
        try {
            this.updatePowerOnDuration(true);
        } catch (error) {
            console.error("Could not persist operation counters during shutdown:", error);
        }
    };

    constructor(buildingBlocks: BaseNode, private readonly store: CounterStore) {
        const counters = buildingBlocks.getChildByName("OperationCounters");
        this.cycleCounter = counters?.getChildByName("OperationCycleCounter") as UAVariable;
        this.operationDuration = counters?.getChildByName("OperationDuration") as UAVariable;
        this.powerOnDuration = counters?.getChildByName("PowerOnDuration") as UAVariable;
        if (!this.cycleCounter || !this.operationDuration || !this.powerOnDuration) {
            throw new Error("Mandatory operation counter nodes not found");
        }

        const state = this.store.load();
        this.cycleCounter.setValueFromSource({
            value: state.operationCycleCounter,
            dataType: DataType.UInt32
        });
        this.operationDuration.setValueFromSource({
            value: state.operationDuration,
            dataType: DataType.Double
        });
        this.powerOnDuration.setValueFromSource({
            value: state.powerOnDuration,
            dataType: DataType.Double
        });

        this.powerOnTimer = setInterval(() => this.updatePowerOnDuration(true), 5000);
        this.powerOnTimer.unref();
        process.once("exit", this.exitHandler);
    }

    public incrementCycleCounter(): number {
        const currentValue = this.cycleCounter.readValue().value.value ?? 0;
        const newValue = Math.min(currentValue + 1, 0xFFFFFFFF);
        this.cycleCounter.setValueFromSource({ value: newValue, dataType: DataType.UInt32 });
        this.store.update({ operationCycleCounter: newValue });
        return newValue;
    }

    public addOperationDuration(duration: number): number {
        if (!Number.isFinite(duration) || duration < 0) {
            throw new Error("Operation duration must be a non-negative finite number");
        }
        const currentValue = this.operationDuration.readValue().value.value ?? 0;
        const newValue = currentValue + duration;
        this.operationDuration.setValueFromSource({ value: newValue, dataType: DataType.Double });
        this.store.update({ operationDuration: newValue });
        return newValue;
    }

    public dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        clearInterval(this.powerOnTimer);
        process.removeListener("exit", this.exitHandler);
        this.updatePowerOnDuration(true);
    }

    private updatePowerOnDuration(persist: boolean): void {
        const now = Date.now();
        const elapsed = Math.max(0, now - this.lastPowerOnUpdate);
        this.lastPowerOnUpdate = now;
        const currentValue = this.powerOnDuration.readValue().value.value ?? 0;
        const newValue = currentValue + elapsed;
        this.powerOnDuration.setValueFromSource({ value: newValue, dataType: DataType.Double });
        if (persist) {
            this.store.update({ powerOnDuration: newValue });
        }
    }
}
