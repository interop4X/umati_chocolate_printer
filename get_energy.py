
import requests
import time

def get_shelly_status(ip):
    url = f"http://{ip}/rpc/Switch.GetStatus?id=0"
    try:
        response = requests.get(url, timeout=5)
        response.raise_for_status()  # Falls Fehler auftreten
        data = response.json()
        return {
            "Leistung (W)": data.get("apower", "N/A"),
            #"Spannung (V)": data.get("voltage", "N/A"),
            #"Strom (A)": data.get("current", "N/A"),
            #"Gesamtverbrauch (Wh)": data.get("aenergy", {}).get("total", "N/A"),
            #"Temperatur (°C)": data.get("temperature", {}).get("tC", "N/A")
        }
    except requests.exceptions.RequestException as e:
        print(f"Fehler beim Abrufen der Daten: {e}")
        return None

def main():
    shelly_ip = "192.168.137.125"  # IP-Adresse deines Shelly
    interval = 0.6  # Abfrage-Intervall in Sekunden
    
    print("Starte Shelly Plus Plug S Monitoring...")
    print(f"Verwende Shelly IP: {shelly_ip}")
    print(f"Abfrage-Intervall: {interval} Sekunden")
    while True:
        status = get_shelly_status(shelly_ip)
        if status:
            for key, value in status.items():
                print(f"{key}: {value}")
        else:
            print("Fehler: Keine Daten empfangen.")
        time.sleep(interval)

if __name__ == "__main__":
    main()

