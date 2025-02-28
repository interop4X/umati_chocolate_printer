import path from 'path';
import SerialPort = require('serialport');
import { promisify } from 'util';
const sleep = promisify(setTimeout);

export class StackLight {
  private port: any;
  private startByte: number;
  private endByte: number;
  private currentLightMode: number;
  private currentFlashFrequency: number;
  private currentBuzzerMode: number;

  constructor(port: string = 'COM3', baudRate: number = 9600) {
    this.startByte = 0xFF;
    this.endByte = 0xAA;
    this.currentLightMode = 0x04; // Default red
    this.currentFlashFrequency = 0x01; // No blinking by default
    this.currentBuzzerMode = 0x01; // Buzzer off by default
    
    try {
      this.port = new SerialPort.SerialPort({ path: port, baudRate: baudRate });
      this.port.on('error', (err:any) => {
        console.error('Serial port error:', err.message);
        this.port = null; // Disconnect if there’s an error
      });
      console.log(`Connected to ${port} at baud rate ${baudRate}`);
    } catch (error) {
      console.error("Failed to connect to Stacklight:", error);
      this.port = null; // Set port to null if connection fails
    }
  }
  

  private async sendCommand(): Promise<void> {
    // Prepare the command
    const command = Buffer.from([
      this.startByte,
      this.currentLightMode,
      this.currentBuzzerMode,
      this.currentFlashFrequency,
      this.endByte
    ]);

    // Send the command over the serial connection
    try {
      this.port.write(command);      
    } catch (error) {
      console.log("error with stacklight")
    }
    await sleep(500); // Wait to ensure the command is sent
  }

  public setLightSync(color: string): void {
    // Set the light color synchronously
    const colorModes: { [key: string]: number } = {
      off: 0x01,
      green: 0x02,
      blue: 0x03,
      red: 0x04,
      cyan: 0x05,
      yellow: 0x06,
      magenta: 0x07,
      white: 0x08
    };

    if (colorModes[color.toLowerCase()]) {
      this.currentLightMode = colorModes[color.toLowerCase()];
    } else {
      throw new Error(`Unknown color: ${color}`);
    }

    try {
    // Send the command synchronously
    this.port.write(Buffer.from([
      this.startByte,
      this.currentLightMode,
      this.currentBuzzerMode,
      this.currentFlashFrequency,
      this.endByte
    ]));      
    } catch (error) {
      
    }

  }

  public async setLight(color: string): Promise<void> {
    // Set the light color asynchronously
    this.setLightSync(color);
    await this.sendCommand();
  }

  public setFlashSync(flash: string): void {
    // Set the flash mode synchronously
    const flashModes: { [key: string]: number } = {
      none: 0x01,
      fast: 0x02,
      normal: 0x03,
      slow: 0x04
    };

    if (flashModes[flash]) {
      this.currentFlashFrequency = flashModes[flash];
    } else {
      throw new Error(`Unknown flash mode: ${flash}`);
    }
    try {
    // Send the command synchronously
      this.port.write(Buffer.from([
        this.startByte,
        this.currentLightMode,
        this.currentBuzzerMode,
        this.currentFlashFrequency,
        this.endByte
      ]));      
    } catch (error) {
      
    }


  }

  public async setFlash(flash: string): Promise<void> {
    // Set the flash mode asynchronously
    this.setFlashSync(flash);
    await this.sendCommand();
  }

  public toggleBuzzerSync(state: boolean): void {
    // Toggle the buzzer synchronously
    this.currentBuzzerMode = state ? 0x02 : 0x01;
    try {
    // Send the command synchronously
      this.port.write(Buffer.from([
        this.startByte,
        this.currentLightMode,
        this.currentBuzzerMode,
        this.currentFlashFrequency,
        this.endByte
      ]));      
    } catch (error) {
      
    }

  }

  public async toggleBuzzer(state: boolean): Promise<void> {
    // Toggle the buzzer asynchronously
    this.toggleBuzzerSync(state);
    await this.sendCommand();
  }

  public async cycleColors(delay: number = 1000): Promise<void> {
    // Cycle through colors with a delay in between
    const colorModes = [0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]; // Green, Blue, Red, Cyan, Yellow, Magenta, White
    for (const mode of colorModes) {
      this.currentLightMode = mode;
      await this.sendCommand();
      await sleep(delay);
    }
  }

  public close(): void {
    // Close the serial connection
    this.setLightSync('off');
    this.toggleBuzzerSync(false);
    try {
      this.port.close();
    } catch (error) {
      
    }
  }
}

/*
// Usage of the StackLight class
(async () => {
  const stackLight = new StackLight('COM3', 9600);

  try {
    // Set the color to green synchronously
    stackLight.setLightSync('green');

    // Set the flash mode to fast asynchronously
    await stackLight.setFlash('fast');

    // Enable the buzzer synchronously
    stackLight.toggleBuzzerSync(true);
    stackLight.toggleBuzzerSync(false);

    // Cycle through colors with a 2-second delay
    await stackLight.cycleColors(2000);
  } finally {
    // Close the serial connection
    stackLight.close();
  }

  console.log('Actions completed.');
})();*/
