import {  LocalizedText,BindVariableOptionsVariation1, Variant, DataType, UAVariable,BaseNode, NodeId} from "node-opcua";


export class MachineryItemState {

    // Member-Variablen
    currentState: LocalizedText = new LocalizedText();
    id: NodeId = new NodeId();
    number: number = 0;
    machineryItemState_node : BaseNode;
    currentState_node : UAVariable;
    currentState_id_node : UAVariable;
    currentState_number_node : UAVariable;
    private machinery_namespace_idx : number = 0;


    // Enum für mögliche Zustände
    public possibleStates = {
        NotAvailable: { number: 0, text: "NotAvailable" , id: new NodeId(NodeId.NodeIdType.NUMERIC,5005,this.machinery_namespace_idx)},
        OutOfService: { number: 1, text: "OutOfService", id: new NodeId(NodeId.NodeIdType.NUMERIC,5004,this.machinery_namespace_idx)},
        Executing: { number: 3, text: "Executing" , id: new NodeId(NodeId.NodeIdType.NUMERIC,5005,this.machinery_namespace_idx)},
        NotExecuting: { number: 2, text: "NotExecuting", id: new NodeId(NodeId.NodeIdType.NUMERIC,5007,this.machinery_namespace_idx)}
    };

    constructor(itemState:BaseNode, machinery_namespace_idx: number) {
        this.number = this.possibleStates.NotAvailable.number;
        this.currentState.text = this.possibleStates.NotAvailable.text;
        this.machineryItemState_node = itemState;
        this.machinery_namespace_idx = machinery_namespace_idx;


        this.currentState_node = itemState?.getChildByName("CurrentState") as UAVariable;
        this.currentState_id_node = this.currentState_node?.getChildByName("Id") as UAVariable;
        this.currentState_number_node = this.currentState_node?.getChildByName("Number") as UAVariable;
        this.currentState_node.setValueFromSource(this.getCurrentStateAsVariant());
    }

    public getCurrentStateAsVariant(): Variant{
        return new Variant (
            {
                value: this.currentState,
                dataType: "LocalizedText"
            }
        )
    }

    public getCurrentStateIDAsVariant(): Variant{
        return new Variant (
            {
                value: this.id,
                dataType: DataType.NodeId
            }
        )
    }

    public getCurrentStateNumberAsVariant(): Variant{
        return new Variant (
            {
                value: this.number,
                dataType: DataType.UInt32
            }
        )
    }

    // Setter für den Zustand basierend auf dem Text und synchronisiere die ID
    public setCurrentStateByText(text: string): void {
        const state = Object.values(this.possibleStates).find(s => s.text === text);
        if (state) {
            this.id = state.id;
            this.currentState.text = state.text;
            this.number = state.number;
            this.currentState_node.setValueFromSource(this.getCurrentStateAsVariant());
            this.currentState_id_node.setValueFromSource(this.getCurrentStateIDAsVariant());
            //this.currentState_number_node.setValueFromSource(this.getCurrentStateNumberAsVariant());

        } else {
            throw new Error(`Invalid state text: ${text}`);
        }
    }
}