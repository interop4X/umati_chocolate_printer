import serial
import time

class StackLight:
    def __init__(self, port='COM3', baudrate=9600):
        """Initialisiert die serielle Verbindung und setzt Standardwerte für den Port und die Baudrate."""
        self.port = port
        self.baudrate = baudrate
        self.ser = serial.Serial(self.port, self.baudrate)
        self.start_byte = 0xFF
        self.end_byte = 0xAA
        self.current_light_mode = 0x04  # Standardmäßig rot
        self.current_flash_frequency = 0x01  # Kein Blinken standardmäßig
        self.current_buzzer_mode = 0x01  # Buzzer aus standardmäßig
    
    def __del__(self):
        self.close()

    
    def send_command(self):
        """Sendet den aktuellen Zustand des Stacklight (Farbe, Flash, Buzzer)."""
        command = [self.start_byte, self.current_light_mode, self.current_buzzer_mode, self.current_flash_frequency, self.end_byte]
        self.ser.write(bytearray(command))
        time.sleep(0.5)
    
    def set_light(self, color):
        """Setzt die Farbe des Lichts."""
        color_modes = {
            "off": 0x01,
            "green": 0x02,
            "blue": 0x03,
            "red": 0x04,
            "cyan": 0x05,
            "yellow": 0x06,
            "magenta": 0x07,
            "white": 0x08
        }
        
        if color.lower() in color_modes:
            self.current_light_mode = color_modes[color.lower()]
        else:
            raise ValueError(f"Unbekannte Farbe: {color}")
        
        self.send_command()
    
    def set_flash(self, flash):
        """Setzt den Flash-Modus."""
        flash_modes = {
            "none": 0x01,
            "fast": 0x02,
            "normal": 0x03,
            "slow": 0x04
        }
        
        if flash in flash_modes:
            self.current_flash_frequency = flash_modes[flash]
        else:
            raise ValueError(f"Unbekannter Flash-Modus: {flash}")
        
        self.send_command()
    
    def toggle_buzzer(self, state):
        """Schaltet den Buzzer ein oder aus."""
        self.current_buzzer_mode = 0x02 if state else 0x01
        self.send_command()
        time.sleep(0.5)
        
    def trigger_buzzer(self):
        stack_light.toggle_buzzer(True)
        stack_light.toggle_buzzer(False)


    
    def cycle_colors(self):
        """Wechselt die Farben des Lichts durch."""
        color_modes = [0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]  # Grün, Blau, Rot, Cyan, Gelb, Magenta, Weiß
        for mode in color_modes:
            time.sleep(2)
            self.current_light_mode = mode
            self.send_command()
    
    def close(self):
        """Schließt die serielle Verbindung."""
        self.set_light("off")
        self.set_flash("none")
        self.toggle_buzzer(False)
        self.ser.close()

# Verwendung der StackLight-Klasse
if __name__ == "__main__":
    stack_light = StackLight(port='COM3', baudrate=9600)
    
    try:
        # Farbe setzen
        stack_light.set_light("green")
        
        # Flash-Modus einstellen
        stack_light.set_flash("fast")
        
        # Buzzer aktivieren
        stack_light.trigger_buzzer()

        
        # Farbwechsel starten
        stack_light.cycle_colors()
        
    finally:
        # Serielle Verbindung schließen
        print("finaly")
        #stack_light.close()

    print("Aktionen abgeschlossen.")