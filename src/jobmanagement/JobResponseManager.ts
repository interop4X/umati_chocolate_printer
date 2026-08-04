import {
    DataType, LocalizedText, NodeId, OPCUAServer, StatusCodes, UAObject,
    UAVariable, Variant, VariantArrayType
} from "node-opcua";

interface JobResponseMetadata {
    responseId: string;
    startTime: Date;
    endTime?: Date;
}

export class JobResponseManager {
    private readonly responses = new Map<string, JobResponseMetadata>();
    private readonly responseDataType: NodeId;

    constructor(
        private readonly server: OPCUAServer,
        jobOrderResults: UAObject,
        private readonly jobOrderList: UAVariable,
        isa95NamespaceIndex: number
    ) {
        const dataType = server.engine.addressSpace?.findDataType(
            "ISA95JobResponseDataType",
            isa95NamespaceIndex
        );
        if (!dataType) {
            throw new Error("ISA95JobResponseDataType not found in AddressSpace");
        }
        this.responseDataType = dataType.nodeId;

        const method = jobOrderResults.getMethodByName("RequestJobResponseByJobOrderID");
        if (!method) {
            throw new Error("RequestJobResponseByJobOrderID method not found");
        }
        method.bindMethod((inputArguments, _context, callback) => {
            const jobOrderId = inputArguments[0]?.value;
            if (typeof jobOrderId !== "string" || !jobOrderId.trim()) {
                callback(null, this.unsuccessfulResult([1, 0]));
                return;
            }

            const job = this.findJob(jobOrderId);
            if (!job) {
                callback(null, this.unsuccessfulResult([0, 2]));
                return;
            }
            const metadata = this.responses.get(jobOrderId);
            if (!metadata) {
                callback(null, this.unsuccessfulResult([0, 8]));
                return;
            }

            try {
                const responseOptions: Record<string, unknown> = {
                    jobResponseID: metadata.responseId,
                    description: new LocalizedText({ text: `Job response for ${jobOrderId}` }),
                    jobOrderID: jobOrderId,
                    startTime: metadata.startTime,
                    jobState: job.state,
                    jobResponseData: [],
                    personnelActuals: [],
                    equipmentActuals: [],
                    physicalAssetActuals: [],
                    materialActuals: []
                };
                if (metadata.endTime) {
                    responseOptions.endTime = metadata.endTime;
                }
                const response = this.server.engine.addressSpace!.constructExtensionObject(
                    this.responseDataType,
                    responseOptions
                );
                callback(null, {
                    statusCode: StatusCodes.Good,
                    outputArguments: [
                        new Variant({ dataType: DataType.ExtensionObject, value: response }),
                        this.returnStatusVariant([0, 1])
                    ]
                });
            } catch (error) {
                console.error("Could not construct JobResponse:", error);
                callback(null, { statusCode: StatusCodes.BadUnexpectedError });
            }
        });
    }

    public start(jobOrderId: string): void {
        if (!this.responses.has(jobOrderId)) {
            this.responses.set(jobOrderId, {
                responseId: `${jobOrderId}-response`,
                startTime: new Date()
            });
        }
    }

    public complete(jobOrderId: string): void {
        const response = this.responses.get(jobOrderId);
        if (response) {
            response.endTime = new Date();
        }
    }

    public remove(jobOrderId: string): void {
        this.responses.delete(jobOrderId);
    }

    private findJob(jobOrderId: string): any | undefined {
        const jobs = this.jobOrderList.readValue().value.value;
        if (!Array.isArray(jobs)) {
            return undefined;
        }
        return jobs.find((entry: any) => entry?.jobOrder?.jobOrderID === jobOrderId);
    }

    private unsuccessfulResult(returnStatus: [number, number]) {
        return {
            statusCode: StatusCodes.Uncertain,
            outputArguments: [
                new Variant({ dataType: DataType.ExtensionObject, value: null }),
                this.returnStatusVariant(returnStatus)
            ]
        };
    }

    private returnStatusVariant(value: [number, number]): Variant {
        return new Variant({
            dataType: DataType.UInt64,
            arrayType: VariantArrayType.Scalar,
            value
        });
    }
}
