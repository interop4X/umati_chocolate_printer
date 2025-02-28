import pyautogui
import time

def move_mouse_if_inactive():
    last_position = pyautogui.position()
    while True:
        time.sleep(60)  # 60 Sekunden warten
        current_position = pyautogui.position()
        
        # Wenn die Maus sich nicht bewegt hat, ein bisschen bewegen
        if current_position == last_position:
            pyautogui.moveRel(5, 0)  # Maus um 5 Pixel nach rechts bewegen
            pyautogui.moveRel(-5, 0) # Maus zurück nach links bewegen
        
        # Position für den nächsten Check speichern
        last_position = pyautogui.position()

move_mouse_if_inactive()
