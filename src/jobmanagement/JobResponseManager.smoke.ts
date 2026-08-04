import * as assert from "assert";
import * as path from "path";
import {
    DataType, NodeId, NodeIdType, OPCUAServer, SessionContext, StatusCodes,
    UAObject, UAMethod, UAVariable, Variant, VariantArrayType, nodesets
} from "node-opcua";
import { JobResponseManager } from "./JobResponseManager";

async function invoke(method: UAMethod, jobOrderId: string) {
    return await new Promise<any>((resolve, reject) => method.execute(
        method.parent as UAObject,
        [new Variant({ dataType: DataType.String, value: jobOrderId })],
        SessionContext.defaultContext,
        (error: Error | null, result: any) => error ? reject(error) : resolve(result)
    ));
}

async function main() {
    const server = new OPCUAServer({
        port: 0,
        nodeset_filename: [nodesets.standard, path.join(__dirname, "..", "..", "models", "demo_siemens.xml")]
    });
    await server.initialize();
    try {
        const addressSpace = server.engine.addressSpace!;
        const isaIndex = addressSpace.getNamespaceIndex("http://opcfoundation.org/UA/ISA95-JOBCONTROL_V2/");
        const machineryJobsIndex = addressSpace.getNamespaceIndex("http://opcfoundation.org/UA/Machinery/Jobs/");
        const provider = addressSpace.findNode(new NodeId(NodeIdType.NUMERIC, 5002, machineryJobsIndex)) as UAObject;
        const receiver = addressSpace.findNode(new NodeId(NodeIdType.NUMERIC, 5001, machineryJobsIndex)) as UAObject;
        assert.ok(provider && receiver);
        const list = receiver.getChildByName("JobOrderList") as UAVariable;
        const method = provider.getMethodByName("RequestJobResponseByJobOrderID")!;
        const state = addressSpace.constructExtensionObject(
            addressSpace.findDataType("ISA95StateDataType", isaIndex)!.nodeId,
            { stateText: "Waiting", stateNumber: 2 }
        );
        const order = addressSpace.constructExtensionObject(
            addressSpace.findDataType("ISA95JobOrderDataType", isaIndex)!.nodeId,
            { jobOrderID: "job-1" }
        );
        const entry = addressSpace.constructExtensionObject(
            addressSpace.findDataType("ISA95JobOrderAndStateDataType", isaIndex)!.nodeId,
            { jobOrder: order, state: [state] }
        );
        list.setValueFromSource({
            dataType: DataType.ExtensionObject,
            arrayType: VariantArrayType.Array,
            value: [entry]
        });
        const manager = new JobResponseManager(server, provider, list, isaIndex);

        let result = await invoke(method, "");
        assert.ok(result.statusCode.equals(StatusCodes.Uncertain));
        assert.deepStrictEqual(result.outputArguments[1].value, [1, 0]);
        result = await invoke(method, "missing");
        assert.deepStrictEqual(result.outputArguments[1].value, [0, 2]);
        result = await invoke(method, "job-1");
        assert.deepStrictEqual(result.outputArguments[1].value, [0, 8]);

        manager.start("job-1");
        result = await invoke(method, "job-1");
        assert.ok(result.statusCode.equals(StatusCodes.Good));
        assert.deepStrictEqual(result.outputArguments[1].value, [0, 1]);
        assert.strictEqual(result.outputArguments[0].value.jobResponseID, "job-1-response");
        assert.strictEqual(result.outputArguments[0].value.jobOrderID, "job-1");
        assert.strictEqual(result.outputArguments[0].value.jobState[0].stateNumber, 2);
        assert.strictEqual(result.outputArguments[0].value.jobState[0].stateText.text, "Waiting");
        assert.ok(result.outputArguments[0].value.startTime instanceof Date);
        assert.strictEqual(result.outputArguments[0].value.endTime, undefined);

        const currentList = list.readValue().value.value;
        currentList[0].state[0].stateNumber = 3;
        currentList[0].state[0].stateText = "Running";
        list.setValueFromSource({
            dataType: DataType.ExtensionObject,
            arrayType: VariantArrayType.Array,
            value: currentList
        });
        result = await invoke(method, "job-1");
        assert.strictEqual(result.outputArguments[0].value.jobState[0].stateNumber, 3);

        manager.complete("job-1");
        result = await invoke(method, "job-1");
        assert.ok(result.outputArguments[0].value.endTime instanceof Date);
        manager.remove("job-1");
        result = await invoke(method, "job-1");
        assert.deepStrictEqual(result.outputArguments[1].value, [0, 8]);
        list.setValueFromSource({
            dataType: DataType.ExtensionObject,
            arrayType: VariantArrayType.Array,
            value: []
        });
        result = await invoke(method, "job-1");
        assert.deepStrictEqual(result.outputArguments[1].value, [0, 2]);
        console.log("JobResponseManager smoke test passed");
    } finally {
        await server.shutdown();
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
