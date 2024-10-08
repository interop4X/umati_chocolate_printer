import { NodeId,NodeIdType, OPCUAServer, nodesets, UAMethod,StatusCodes, UAVariable, DataType, Variant } from "node-opcua";

export interface PrintJob {
    id: number;
    jtd: string;
    status: "NotAllowedToStart" | "AllowedToStart" | "Running" | "Ended";
    startTime : number;
    endTime : number;
    jobOrder : Variant;

}

class PrintJobManager {
    private static instance: PrintJobManager;
    private jobs: PrintJob[];

    private constructor() {
        this.jobs = [];
    }

    // Singleton-Instanz abrufen
    public static getInstance(): PrintJobManager {
        if (!PrintJobManager.instance) {
            PrintJobManager.instance = new PrintJobManager();
        }
        return PrintJobManager.instance;
    }

    // Fügt einen neuen Druckauftrag hinzu
    public addJob(job: PrintJob): void {
        this.jobs.push(job);
    }

    // Gibt alle Druckaufträge zurück
    public getJobs(): PrintJob[] {
        return this.jobs;
    }
}

// Exportiere die Singleton-Instanz
export const printJobManager = PrintJobManager.getInstance();