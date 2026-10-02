import * as fs from "fs";
import * as path from "path";
import {
    DataType,
    LocalizedText,
    NodeId,
    NodeIdType,
    OPCUAServer,
    RelativePath,
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

function isa95MethodResult(bit: Isa95ReturnStatusBit, statusCode = StatusCodes.Good) {
    return {
        statusCode,
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

type JobStateDefinition = {
    stateText: string;
    stateNumber: number;
    browsePath?: RelativePath | null;
};

type RunningSubState = "PreparePrint" | "Print";

export class JobManagementService {
    private readonly jobOrderList: UAVariable;
    private readonly jobOrderControl: UAObject;
    private readonly jobOrderResults: UAObject;
    private readonly jobResponseManager: JobResponseManager;
    private readonly jobOrderStatusEventType: any;
    private readonly jobResponseDataType: NodeId;

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
        this.jobOrderControl = jobOrderControl;
        this.jobOrderResults = jobOrderResults;

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

        this.jobOrderStatusEventType = this.ensureJobOrderStatusEventType();
        this.jobResponseDataType = this.resolveJobResponseDataType();
        this.ensureEventNotifier();

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

    public setRunningSubState(jobOrderId: string, subState: RunningSubState): void {
        const subStateNumber = subState === "PreparePrint" ? 31 : 32;
        this.setJobState(jobOrderId, {
            stateText: "Running",
            stateNumber: 3
        }, {
            stateText: subState,
            stateNumber: subStateNumber,
            browsePath: this.createRelativePath(subState)
        }, {
            transition: `Running/${subState}`,
            severity: 200
        });
    }

    private clear(inputArguments: Variant[], _context: unknown, callback: any): void {
        const jobOrderId = inputArguments[0]?.value;
        if (typeof jobOrderId !== "string" || !jobOrderId.trim()) {
            callback(null, isa95MethodResult(Isa95ReturnStatusBit.InvalidRequest, StatusCodes.Uncertain));
            return;
        }

        const list = this.jobOrderList.readValue();
        const jobs = list.value.value;
        if (!Array.isArray(jobs)) {
            callback(null, isa95MethodResult(Isa95ReturnStatusBit.InvalidRequest, StatusCodes.Uncertain));
            return;
        }

        const jobIndex = jobs.findIndex((job: any) => job?.jobOrder?.jobOrderID === jobOrderId);
        if (jobIndex === -1) {
            callback(null, isa95MethodResult(Isa95ReturnStatusBit.UnknownJobOrderId, StatusCodes.Uncertain));
            return;
        }

        jobs.splice(jobIndex, 1);
        list.value.dimensions = [jobs.length];
        this.jobOrderList.setValueFromSource(list.value);
        this.jobResponseManager.remove(jobOrderId);

        callback(null, isa95MethodResult(Isa95ReturnStatusBit.NoError));
    }

    private bindMethods(jobOrderControl: UAObject): void {
        const storeMethod = jobOrderControl.getChildByName("Store") as UAMethod;
        const storeAndStartMethod = jobOrderControl.getChildByName("StoreAndStart") as UAMethod;
        const startMethod = jobOrderControl.getChildByName("Start") as UAMethod;
        const clearMethod = jobOrderControl.getChildByName("Clear") as UAMethod;

        storeMethod.bindMethod((inputArguments, context, callback) => this.store(inputArguments, context, callback));
        storeAndStartMethod.bindMethod((inputArguments, context, callback) => this.store(inputArguments, context, callback));
        startMethod.bindMethod((inputArguments, context, callback) => this.start(inputArguments, context, callback));
        clearMethod.bindMethod((inputArguments, context, callback) => this.clear(inputArguments, context, callback));
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

        console.log(`[JobOrderControl.Store] Received JobOrderID=${jobOrderId}`);
        console.dir(inputJobOrder, { depth: null });

        const currentJobs = this.jobOrderList.readValue().value.value;
        if (!Array.isArray(currentJobs)) {
            callback(null, isa95MethodResult(Isa95ReturnStatusBit.UnableToAcceptJobOrder));
            return;
        }
        if (currentJobs.some((entry: any) => entry?.jobOrder?.jobOrderID === jobOrderId)) {
            callback(null, isa95MethodResult(Isa95ReturnStatusBit.UnableToAcceptJobOrder));
            return;
        }

        const orderAndState = this.server.engine.addressSpace?.constructExtensionObject(
            new NodeId(
                NodeIdType.NUMERIC,
                3015,
                this.server.engine.addressSpace?.getNamespaceIndex("http://opcfoundation.org/UA/ISA95-JOBCONTROL_V2/")
            ),
            {}
        ) as any;

        orderAndState.jobOrder = inputJobOrder;
        orderAndState.state = [
            this.createState({
                browsePath: null,
                stateText: "NotAllowedToStart",
                stateNumber: 1
            }),
            this.createState({
                browsePath: this.createRelativePath("NotAllowedToStartSubstates"),
                stateText: "Ready",
                stateNumber: 2
            })
        ];

        const list = this.jobOrderList.readValue();
        const listValue = list.value;
        listValue.value.push(orderAndState);
        listValue.dimensions![0] = listValue.dimensions![0] + 1;
        this.jobOrderList.setValueFromSource(listValue);

        this.raiseJobOrderStatusEvent(
            jobOrderId,
            orderAndState.jobOrder,
            orderAndState.state,
            "Store/NotAllowedToStart/Ready",
            100
        );

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

        const allowedToStartSet = this.setJobState(jobOrderId, {
            stateText: "AllowedToStart",
            stateNumber: 2
        }, {
            stateText: "Ready",
            stateNumber: 2,
            browsePath: this.createRelativePath("AllowedToStartSubstates")
        }, {
            transition: "Start/AllowedToStart/Ready",
            severity: 150
        });
        if (!allowedToStartSet) {
            callback(null, isa95MethodResult(Isa95ReturnStatusBit.UnknownJobOrderId));
            return;
        }

        this.jobResponseManager.start(jobOrderId);
        this.options.onJobStart?.(jobOrderId);

        const source: JobExecutionSource = job.jobOrder.jobOrderParameters ? "umati" : "default";
        const recipePath = this.resolveRecipePath(job);

        callback(null, isa95MethodResult(Isa95ReturnStatusBit.NoError));

        this.options.executeJob(jobOrderId, recipePath, source)
            .then(() => {
                this.setJobState(jobOrderId, {
                    stateText: "Ended",
                    stateNumber: 5
                }, undefined, {
                    transition: "Completed/Ended",
                    severity: 250
                });
                this.jobResponseManager.complete(jobOrderId);
                this.options.onJobSuccess?.(jobOrderId);
            })
            .catch((error: unknown) => {
                this.setJobState(jobOrderId, {
                    stateText: "Aborted",
                    stateNumber: 6
                }, undefined, {
                    transition: "Failed/Aborted",
                    severity: 700
                });
                this.jobResponseManager.complete(jobOrderId);
                this.options.onJobFailure?.(jobOrderId, error);
            });
    }

    private setJobState(
        jobOrderId: string,
        topState: JobStateDefinition,
        subState?: JobStateDefinition,
        eventMeta?: { transition: string; severity: number }
    ): boolean {
        const list = this.jobOrderList.readValue();
        if (!Array.isArray(list.value.value)) {
            return false;
        }

        const job = (list.value.value as any[]).find((entry: any) => entry?.jobOrder?.jobOrderID === jobOrderId);
        if (!job) {
            return false;
        }

        const states = [this.createState(topState)];
        if (subState) {
            states.push(this.createState(subState));
        }
        job.state = states;
        this.jobOrderList.setValueFromSource(list.value);

        if (eventMeta) {
            this.raiseJobOrderStatusEvent(
                jobOrderId,
                job.jobOrder,
                states,
                eventMeta.transition,
                eventMeta.severity
            );
        }

        return true;
    }

    private ensureJobOrderStatusEventType(): any {
        const addressSpace = this.server.engine.addressSpace;
        if (!addressSpace) {
            throw new Error("AddressSpace not initialized");
        }

        const baseEventType = addressSpace.findEventType("ISA95JobOrderStatusEventType", this.isa95NamespaceIndex);
        if (!baseEventType) {
            throw new Error("ISA95JobOrderStatusEventType not found");
        }

        if (!baseEventType.isAbstract) {
            return baseEventType;
        }

        const ownNamespace = addressSpace.getOwnNamespace();
        const concreteName = "LocalISA95JobOrderStatusEventType";
        const existingEventType = addressSpace.findEventType(concreteName, ownNamespace.index);
        if (existingEventType) {
            return existingEventType;
        }

        return ownNamespace.addEventType({
            browseName: concreteName,
            subtypeOf: baseEventType
        });
    }

    private resolveJobResponseDataType(): NodeId {
        const dataType = this.server.engine.addressSpace?.findDataType(
            "ISA95JobResponseDataType",
            this.isa95NamespaceIndex
        );
        if (!dataType) {
            throw new Error("ISA95JobResponseDataType not found");
        }
        return dataType.nodeId;
    }

    private ensureEventNotifier(): void {
        if (this.jobOrderControl.eventNotifier === 0) {
            this.jobOrderControl.setEventNotifier(0x1);
        }
        if (this.jobOrderResults.eventNotifier === 0) {
            this.jobOrderResults.setEventNotifier(0x1);
        }
    }

    private raiseJobOrderStatusEvent(
        jobOrderId: string,
        jobOrder: any,
        jobState: any[],
        transition: string,
        severity: number
    ): void {
        try {
            const addressSpace = this.server.engine.addressSpace;
            if (!addressSpace) {
                throw new Error("AddressSpace not initialized");
            }
            const eventTime = new Date();
            const jobResponse = addressSpace.constructExtensionObject(this.jobResponseDataType, {
                jobResponseID: `${jobOrderId}-status-${eventTime.getTime()}`,
                description: new LocalizedText({ text: `Status event for ${jobOrderId}` }),
                jobOrderID: jobOrderId,
                startTime: eventTime,
                jobState,
                jobResponseData: [],
                personnelActuals: [],
                equipmentActuals: [],
                physicalAssetActuals: [],
                materialActuals: []
            });

            const eventPayload: any = {
                sourceNode: {
                    dataType: DataType.NodeId,
                    value: this.jobOrderControl.nodeId
                },
                sourceName: {
                    dataType: DataType.String,
                    value: "JobOrderControl"
                },
                message: {
                    dataType: DataType.LocalizedText,
                    value: new LocalizedText({ text: `${jobOrderId}: ${transition}` })
                },
                severity: {
                    dataType: DataType.UInt16,
                    value: severity
                },
                time: {
                    dataType: DataType.DateTime,
                    value: eventTime
                },
                jobOrder: {
                    dataType: DataType.ExtensionObject,
                    value: jobOrder
                },
                jobState: {
                    dataType: DataType.ExtensionObject,
                    arrayType: VariantArrayType.Array,
                    value: jobState
                },
                jobResponse: {
                    dataType: DataType.ExtensionObject,
                    value: jobResponse
                }
            };

            this.jobOrderControl.raiseEvent(this.jobOrderStatusEventType, eventPayload);
        } catch (error) {
            console.error(`Failed to raise ISA95 JobOrderStatus event for ${jobOrderId}:`, error);
        }
    }

    private createState(definition: JobStateDefinition): any {
        return this.server.engine.addressSpace?.constructExtensionObject(
            new NodeId(
                NodeIdType.NUMERIC,
                3006,
                this.server.engine.addressSpace?.getNamespaceIndex("http://opcfoundation.org/UA/ISA95-JOBCONTROL_V2/")
            ),
            {
                browsePath: definition.browsePath ?? null,
                stateText: definition.stateText,
                stateNumber: definition.stateNumber
            }
        );
    }

    private createRelativePath(targetName: string): RelativePath {
        return new RelativePath({
            elements: [{
                referenceTypeId: new NodeId(NodeIdType.NUMERIC, 33, 0),
                isInverse: false,
                includeSubtypes: true,
                targetName: {
                    namespaceIndex: this.isa95NamespaceIndex,
                    name: targetName
                }
            }]
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
