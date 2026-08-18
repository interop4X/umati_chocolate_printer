import * as fs from "fs";
import * as path from "path";
import {
    DataType,
    NodeId,
    NodeIdType,
    OPCUAServer,
    StatusCodes,
    UAObject,
    UAMethod,
    UAVariable,
    Variant,
    VariantArrayType
} from "node-opcua";
import { JobResponseManager } from "./JobResponseManager";

enum Isa95ReturnStatusBit {
    NoError = 0,
    UnknownJobOrderId = 1,
    InvalidJobOrderStatus = 3,
    UnableToAcceptJobOrder = 4,
    InvalidRequest = 32
}

function isa95ReturnStatus(bit: Isa95ReturnStatusBit): Variant {
    const value: [number, number] = bit < 32
        ? [0, Math.pow(2, bit)]
        : [Math.pow(2, bit - 32), 0];

    return new Variant({
        dataType: DataType.UInt64,
        arrayType: VariantArrayType.Scalar,
        value
    });
}

function isa95MethodResult(bit: Isa95ReturnStatusBit) {
    return {
        statusCode: StatusCodes.Good,
        outputArguments: [isa95ReturnStatus(bit)]
    };
}

type JobExecutionSource = "umati" | "default";

interface JobManagementServiceOptions {
    dataDirectory: string;
    executeJob: (jobOrderId: string, recipePath: string, source: JobExecutionSource) => Promise<void>;
    onJobStart?: (jobOrderId: string) => void;
    onJobSuccess?: (jobOrderId: string) => void;
    onJobFailure?: (jobOrderId: string, error: unknown) => void;
}

export class JobManagementService {
    private readonly jobOrderList: UAVariable;
    private readonly jobResponseManager: JobResponseManager;

    constructor(
        private readonly server: OPCUAServer,
        machineryBuildingBlocks: UAObject,
        private readonly isa95NamespaceIndex: number,
        private readonly options: JobManagementServiceOptions
    ) {
        const jobManagement = machineryBuildingBlocks.getChildByName("JobManagement") as UAObject | null;
        if (!jobManagement) {
            throw new Error("JobManagement node not found");
        }

        const jobOrderControl = jobManagement.getChildByName("JobOrderControl") as UAObject | null;
        const jobOrderResults = jobManagement.getChildByName("JobOrderResults") as UAObject | null;
        if (!jobOrderControl || !jobOrderResults) {
            throw new Error("JobOrderControl or JobOrderResults node not found");
        }

        this.jobOrderList = jobOrderControl.getChildByName("JobOrderList") as UAVariable;
        if (!this.jobOrderList) {
            throw new Error("JobOrderList node not found");
        }

        this.resetJobOrderList();

        this.jobResponseManager = new JobResponseManager(
            server,
            jobOrderResults,
            this.jobOrderList,
            isa95NamespaceIndex
        );

        this.bindMethods(jobOrderControl);
    }

    public startCleanupTimers(): void {
        setInterval(() => {
            const list = this.jobOrderList.readValue();
            for (const job of list.value.value as any[]) {
                if (job?.state?.[0]?.stateNumber === 6) {
                    job.state[0].stateNumber = 5;
                    job.state[0].stateText = "Ended";
                }
            }
            this.jobOrderList.setValueFromSource(list.value);
        }, 5 * 1000);

        setInterval(() => {
            const list = this.jobOrderList.readValue();
            for (let i = (list.value.value as any[]).length - 1; i >= 0; i--) {
                const job = (list.value.value as any[])[i];
                if (job?.state?.[0]?.stateNumber === 5) {
                    this.jobResponseManager.remove(job.jobOrder.jobOrderID);
                    (list.value.value as any[]).splice(i, 1);
                    list.value.dimensions![0] = list.value.dimensions![0] - 1;
                }
            }
            this.jobOrderList.setValueFromSource(list.value);
        }, 7 * 60 * 60 * 1000);
    }

    private bindMethods(jobOrderControl: UAObject): void {
        const storeMethod = jobOrderControl.getChildByName("Store") as UAMethod;
        const storeAndStartMethod = jobOrderControl.getChildByName("StoreAndStart") as UAMethod;
        const startMethod = jobOrderControl.getChildByName("Start") as UAMethod;

        storeMethod.bindMethod((inputArguments, context, callback) => this.store(inputArguments, context, callback));
        storeAndStartMethod.bindMethod((inputArguments, context, callback) => this.store(inputArguments, context, callback));
        startMethod.bindMethod((inputArguments, context, callback) => this.start(inputArguments, context, callback));
    }

    private resetJobOrderList(): void {
        const list = this.jobOrderList.readValue();
        const listValue = list.value;
        listValue.value = [];
        listValue.arrayType = VariantArrayType.Array;
        listValue.dimensions = [0];
        this.jobOrderList.setValueFromSource(listValue);
    }

    private store(inputArguments: Variant[], _context: unknown, callback: any): void {
        const inputJobOrder = inputArguments[0]?.value;
        const jobOrderId = inputJobOrder?.jobOrderID;
        if (typeof jobOrderId !== "string" || !jobOrderId.trim()) {
            callback(null, isa95MethodResult(Isa95ReturnStatusBit.InvalidRequest));
            return;
        }

        const currentJobs = this.jobOrderList.readValue().value.value;
        if (!Array.isArray(currentJobs)) {
            callback(null, isa95MethodResult(Isa95ReturnStatusBit.UnableToAcceptJobOrder));
            return;
        }
        if (currentJobs.some((entry: any) => entry?.jobOrder?.jobOrderID === jobOrderId)) {
            callback(null, isa95MethodResult(Isa95ReturnStatusBit.UnableToAcceptJobOrder));
            return;
        }

        const state = this.server.engine.addressSpace?.constructExtensionObject(
            new NodeId(
                NodeIdType.NUMERIC,
                3006,
                this.server.engine.addressSpace?.getNamespaceIndex("http://opcfoundation.org/UA/ISA95-JOBCONTROL_V2/")
            ),
            {
                browsePath: null,
                stateText: "NotAllowedToStart",
                stateNumber: "1"
            }
        );

        const orderAndState = this.server.engine.addressSpace?.constructExtensionObject(
            new NodeId(
                NodeIdType.NUMERIC,
                3015,
                this.server.engine.addressSpace?.getNamespaceIndex("http://opcfoundation.org/UA/ISA95-JOBCONTROL_V2/")
            ),
            {}
        ) as any;

        orderAndState.jobOrder = inputJobOrder;
        orderAndState.state[0] = state;

        const list = this.jobOrderList.readValue();
        const listValue = list.value;
        listValue.value.push(orderAndState);
        listValue.dimensions![0] = listValue.dimensions![0] + 1;
        this.jobOrderList.setValueFromSource(listValue);

        callback(null, isa95MethodResult(Isa95ReturnStatusBit.NoError));
    }

    private start(inputArguments: Variant[], _context: unknown, callback: any): void {
        const jobOrderId = inputArguments[0]?.value;
        if (typeof jobOrderId !== "string" || !jobOrderId.trim()) {
            callback(null, isa95MethodResult(Isa95ReturnStatusBit.InvalidRequest));
            return;
        }

        const list = this.jobOrderList.readValue();
        if (!Array.isArray(list.value.value)) {
            callback(null, isa95MethodResult(Isa95ReturnStatusBit.InvalidRequest));
            return;
        }

        const job = (list.value.value as any[]).find((entry: any) => entry?.jobOrder?.jobOrderID === jobOrderId);
        if (!job) {
            callback(null, isa95MethodResult(Isa95ReturnStatusBit.UnknownJobOrderId));
            return;
        }

        const jobState = job.state?.[0]?.stateNumber;
        if (jobState !== 1 && jobState !== 2) {
            callback(null, isa95MethodResult(Isa95ReturnStatusBit.InvalidJobOrderStatus));
            return;
        }

        job.state[0].stateNumber = 3;
        job.state[0].stateText = "Running";
        this.jobOrderList.setValueFromSource(list.value);
        this.jobResponseManager.start(jobOrderId);
        this.options.onJobStart?.(jobOrderId);

        const source: JobExecutionSource = job.jobOrder.jobOrderParameters ? "umati" : "default";
        const recipePath = this.resolveRecipePath(job);

        callback(null, isa95MethodResult(Isa95ReturnStatusBit.NoError));

        this.options.executeJob(jobOrderId, recipePath, source)
            .then(() => {
                const currentList = this.jobOrderList.readValue();
                const currentJob = (currentList.value.value as any[]).find((entry: any) => entry?.jobOrder?.jobOrderID === jobOrderId);
                if (currentJob) {
                    currentJob.state[0].stateNumber = 5;
                    currentJob.state[0].stateText = "Ended";
                    this.jobOrderList.setValueFromSource(currentList.value);
                }
                this.jobResponseManager.complete(jobOrderId);
                this.options.onJobSuccess?.(jobOrderId);
            })
            .catch((error: unknown) => {
                const currentList = this.jobOrderList.readValue();
                const currentJob = (currentList.value.value as any[]).find((entry: any) => entry?.jobOrder?.jobOrderID === jobOrderId);
                if (currentJob) {
                    currentJob.state[0].stateNumber = 6;
                    currentJob.state[0].stateText = "Aborted";
                    this.jobOrderList.setValueFromSource(currentList.value);
                }
                this.jobResponseManager.complete(jobOrderId);
                this.options.onJobFailure?.(jobOrderId, error);
            });
    }

    private resolveRecipePath(job: any): string {
        const defaultRecipePath = path.join(this.options.dataDirectory, "default.json");
        const workMasters = job?.jobOrder?.workMasterID;

        if (!Array.isArray(workMasters) || workMasters.length === 0) {
            return defaultRecipePath;
        }

        const localPathParameter = workMasters
            .flatMap((workMaster: any) => Array.isArray(workMaster?.parameters) ? workMaster.parameters : [])
            .find((parameter: any) => parameter?.ID === "LocalPath");

        const localPath = localPathParameter?.value?.value;
        if (typeof localPath !== "string" || !localPath.trim()) {
            return defaultRecipePath;
        }

        const candidatePath = path.resolve(this.options.dataDirectory, localPath.trim());
        const isInsideDataDirectory =
            candidatePath === this.options.dataDirectory ||
            candidatePath.startsWith(this.options.dataDirectory + path.sep);

        if (!isInsideDataDirectory) {
            return defaultRecipePath;
        }

        if (!fs.existsSync(candidatePath) || !fs.statSync(candidatePath).isFile()) {
            return defaultRecipePath;
        }

        return candidatePath;
    }
}
