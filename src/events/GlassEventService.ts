import { DataType, LocalizedText, Namespace, OPCUAServer, UAObject, UAObjectType } from "node-opcua";

const GLASS_NAMESPACE_URI = "http://opcfoundation.org/UA/Glass/Flat/v2/";

const MATERIAL_IDENTIFIER = "Label";
const COMPONENT_NAME = "Label";
const PROCESSING_IDENTIFICATION = "LabelPrinting";

interface GlassEventServiceOptions {
    server: OPCUAServer;
    source: UAObject;
    namespace: Namespace;
}

export class GlassEventService {
    private readonly source: UAObject;
    private readonly componentInEventType: UAObjectType;
    private readonly processingInEventType: UAObjectType;
    private readonly processingOutEventType: UAObjectType;
    private readonly componentOutEventType: UAObjectType;

    constructor(options: GlassEventServiceOptions) {
        const { server, source, namespace } = options;
        const addressSpace = server.engine.addressSpace;
        if (!addressSpace) {
            throw new Error("AddressSpace not initialized");
        }

        const glassNamespaceIndex = addressSpace.getNamespaceIndex(GLASS_NAMESPACE_URI);
        if (glassNamespaceIndex < 0) {
            throw new Error("Glass Flat namespace not found in address space");
        }

        this.source = source;

        const concreteEventType = (candidateNames: string[], localName: string): UAObjectType => {
            const existing = addressSpace.findEventType(localName, namespace.index);
            if (existing) {
                return existing;
            }
            for (const candidate of candidateNames) {
                const baseType = addressSpace.findEventType(candidate, glassNamespaceIndex);
                if (baseType) {
                    // The Glass event types are abstract, so a concrete subtype is required to raise events.
                    return namespace.addEventType({ browseName: localName, subtypeOf: baseType });
                }
            }
            throw new Error(`Glass event type not found: ${candidateNames.join(", ")}`);
        };

        this.componentInEventType = concreteEventType(["ComponentInEventType"], "LocalComponentInEventType");
        this.processingInEventType = concreteEventType(["ProcessingInEventType"], "LocalProcessingInEventType");
        this.processingOutEventType = concreteEventType(["ProcessingOutEventType"], "LocalProcessingOutEventType");
        // The nodeset spells the type without the "t" in "Component".
        this.componentOutEventType = concreteEventType(
            ["ComponentOutEventType", "ComponenOutEventType"],
            "LocalComponentOutEventType"
        );

        if (this.source.eventNotifier === 0) {
            this.source.setEventNotifier(0x1);
        }
        const serverObject = addressSpace.rootFolder.objects.server;
        if (serverObject) {
            serverObject.addReference({ referenceType: "HasNotifier", nodeId: this.source.nodeId });
        }
    }

    public raiseComponentIn(jobOrderId: string): void {
        this.raise(this.componentInEventType, jobOrderId, "ComponentIn", {
            componentName: { dataType: DataType.String, value: COMPONENT_NAME }
        });
    }

    public raiseProcessingIn(jobOrderId: string): void {
        this.raise(this.processingInEventType, jobOrderId, "ProcessingIn", {
            processingIdentification: { dataType: DataType.String, value: PROCESSING_IDENTIFICATION }
        });
    }

    public raiseProcessingOut(jobOrderId: string): void {
        this.raise(this.processingOutEventType, jobOrderId, "ProcessingOut", {
            processingIdentification: { dataType: DataType.String, value: PROCESSING_IDENTIFICATION }
        });
    }

    public raiseComponentOut(jobOrderId: string): void {
        this.raise(this.componentOutEventType, jobOrderId, "ComponentOut", {
            componentName: { dataType: DataType.String, value: COMPONENT_NAME }
        });
    }

    private raise(eventType: UAObjectType, jobOrderId: string, transition: string, specificFields: Record<string, unknown>): void {
        try {
            this.source.raiseEvent(eventType, {
                sourceNode: { dataType: DataType.NodeId, value: this.source.nodeId },
                sourceName: { dataType: DataType.String, value: this.source.browseName.name },
                message: {
                    dataType: DataType.LocalizedText,
                    value: new LocalizedText({ text: `${jobOrderId}: ${transition}` })
                },
                severity: { dataType: DataType.UInt16, value: 100 },
                time: { dataType: DataType.DateTime, value: new Date() },
                jobdIdentifier: { dataType: DataType.String, value: jobOrderId },
                location: { dataType: DataType.String, value: "" },
                materialIdentifier: { dataType: DataType.String, value: MATERIAL_IDENTIFIER },
                ...specificFields
            } as any);
        } catch (error) {
            console.error(`Fehler beim Auslösen des Glass-Events ${transition} für ${jobOrderId}:`, error);
        }
    }
}
