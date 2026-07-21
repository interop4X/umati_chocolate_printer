import * as fs from "fs";
import * as path from "path";

export interface CounterState {
    lifetimeCounter: number;
    operationCycleCounter: number;
    operationDuration: number;
    powerOnDuration: number;
}

const EMPTY_STATE: CounterState = {
    lifetimeCounter: 0,
    operationCycleCounter: 0,
    operationDuration: 0,
    powerOnDuration: 0
};

export class CounterStore {
    private state?: CounterState;

    constructor(private readonly filename: string) {}

    public load(): CounterState {
        if (this.state) {
            return { ...this.state };
        }
        if (!fs.existsSync(this.filename)) {
            this.state = { ...EMPTY_STATE };
            return { ...this.state };
        }
        try {
            const value = JSON.parse(fs.readFileSync(this.filename, "utf8")) as Partial<CounterState>;
            this.state = {
                lifetimeCounter: this.validNumber(value.lifetimeCounter, 0xFFFFFFFF, true),
                operationCycleCounter: this.validNumber(value.operationCycleCounter, 0xFFFFFFFF, true),
                operationDuration: this.validNumber(value.operationDuration),
                powerOnDuration: this.validNumber(value.powerOnDuration)
            };
            return { ...this.state };
        } catch (error) {
            console.error(`Could not load counter state from ${this.filename}; using zero values:`, error);
            this.state = { ...EMPTY_STATE };
            return { ...this.state };
        }
    }

    public save(state: CounterState): void {
        const directory = path.dirname(this.filename);
        fs.mkdirSync(directory, { recursive: true });
        const temporaryFilename = `${this.filename}.${process.pid}.tmp`;
        const persistedState = {
            version: 1,
            ...state,
            updatedAt: new Date().toISOString()
        };
        fs.writeFileSync(temporaryFilename, JSON.stringify(persistedState, null, 2), "utf8");
        fs.renameSync(temporaryFilename, this.filename);
        this.state = { ...state };
    }

    public update(values: Partial<CounterState>): void {
        this.save({ ...this.load(), ...values });
    }

    private validNumber(value: unknown, maximum = Number.MAX_SAFE_INTEGER, integer = false): number {
        if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
            return 0;
        }
        const boundedValue = Math.min(value, maximum);
        return integer ? Math.floor(boundedValue) : boundedValue;
    }
}
