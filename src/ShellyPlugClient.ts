export class ShellyPlugClient {
    private readonly ip: string;

    constructor(ip: string) {
        this.ip = ip;
    }

    /**
     * Gibt die aktuelle Wirkleistung (AC active power) in Watt zurück.
     */
    public async getActivePower(): Promise<number | null> {
        const url = `http://${this.ip}/rpc/Switch.GetStatus?id=0`;

        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP-Fehler: ${response.status}`);
            }

            const data = await response.json();
            const leistung = data.apower;

            return typeof leistung === 'number' ? leistung : null;

        } catch (error) {
            console.error(`Fehler beim Abrufen der Leistung: ${(error as Error).message}`);
            return null;
        }
    }

    /**
     * Schaltet den Plug auf EIN.
     */
    public async setPowerOn(): Promise<boolean> {
        return this.sendSwitchCommand(true);
    }

    /**
     * Schaltet den Plug auf AUS.
     */
    public async setPowerOff(): Promise<boolean> {
        return this.sendSwitchCommand(false);
    }

    /**
     * Liefert den vollständigen Schaltstatus des Geräts.
     */
    public async getStatus(): Promise<any | null> {
        const url = `http://${this.ip}/rpc/Switch.GetStatus?id=0`;

        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP-Fehler: ${response.status}`);
            }

            return await response.json();

        } catch (error) {
            console.error(`Fehler beim Abrufen des Status: ${(error as Error).message}`);
            return null;
        }
    }

    /**
     * Private Hilfsmethode zum Senden des Schaltbefehls.
     */
    private async sendSwitchCommand(state: boolean): Promise<boolean> {
        const url = `http://${this.ip}/rpc/Switch.Set`;
        const payload = { id: 0, on: state };

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error(`HTTP-Fehler: ${response.status}`);
            }

            return true;

        } catch (error) {
            console.error(`Fehler beim Schalten des Plugs (${state ? 'ON' : 'OFF'}): ${(error as Error).message}`);
            return false;
        }
    }
}