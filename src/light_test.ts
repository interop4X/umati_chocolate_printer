import { StackLight } from './StackLight'; // Import the StackLight module
import { promisify } from 'util';
const sleep = promisify(setTimeout);

(async () => {
  const stackLight = new StackLight('COM3', 9600);

  try {
    // Set the color to green
    await stackLight.setLight('green');

    // Set the flash mode to fast
    await stackLight.setFlash('fast');

    // Turn the buzzer on
  } catch (error) {
    console.error('Error controlling the stack light:', error);
  } finally {
    // Ensure the serial port is closed
    stackLight.close();
  }

  console.log('Stack light control completed.');
})();
