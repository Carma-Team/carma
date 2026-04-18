// import BleManager from 'react-native-ble-manager';
// import { NativeEventEmitter, NativeModules } from 'react-native';

/**
 * MOCKED BluetoothManager
 * This is a temporary implementation to prevent app crashes when
 * 'react-native-ble-manager' is not installed or when running in Web/Expo Go.
 */

export class BluetoothManager {
  private targetDeviceId: string | null = null;
  private onConnect: () => void;
  private onDisconnect: () => void;

  constructor(onConnect: () => void, onDisconnect: () => void) {
    this.onConnect = onConnect;
    this.onDisconnect = onDisconnect;
    this.init();
  }

  private init() {
    console.log('[SDK] BluetoothManager Initialized (MOCKED MODE)');
    // In a real device, we would add listeners here.
  }

  public setTargetDevice(id: string | null) {
    this.targetDeviceId = id;
    console.log('[SDK] Target Bluetooth Device set to:', id);
  }

  /**
   * Mocked version of getting bonded devices
   */
  public async getBondedDevices() {
    console.log('[SDK] Getting Bonded Devices (MOCKED)');
    return [
      { id: 'mock-1', name: 'My Tesla Model 3' },
      { id: 'mock-2', name: 'Car Bluetooth BT-45' },
    ];
  }

  /**
   * Mocked check for current connection
   */
  public async checkCurrentConnection() {
    return false;
  }
}
