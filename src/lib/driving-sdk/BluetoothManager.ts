/**
 * @fileoverview ניהול חיבור Bluetooth לרכב — BluetoothManager
 * @module lib/driving-sdk/BluetoothManager
 *
 * @description
 * מימוש Mock בלבד (ללא תלויות native) לצורך פיתוח ו-Expo Go.
 * מחזיר רשימת מכשירים מדומה ומאפשר סימולציה של חיבור/ניתוק.
 * כשהאפליקציה תועבר לייצור — יוחלף ב-BleManager אמיתי (react-native-ble-plx).
 *
 * @remarks ללא קריאות שרת — כל הנתונים מקומיים.
 */

export interface BluetoothDevice {
  id: string;
  name: string;
}

export class BluetoothManager {
  private targetDeviceId: string | null = null;
  private onConnect: () => void;
  private onDisconnect: () => void;

  constructor(onConnect: () => void, onDisconnect: () => void) {
    this.onConnect = onConnect;
    this.onDisconnect = onDisconnect;
    console.log('[SDK] BluetoothManager initialized in Mock mode');
  }

  public setTargetDevice(id: string | null) {
    this.targetDeviceId = id;
    console.log('[SDK] Target device set to:', id);
  }

  public getTargetDevice(): string | null {
    return this.targetDeviceId;
  }

  public async getBondedDevices(): Promise<BluetoothDevice[]> {
    return [
      { id: 'car-bt-01', name: 'My Tesla Model 3' },
      { id: 'car-bt-02', name: 'Toyota Multimedia' },
      { id: 'car-bt-03', name: 'Mazda Connect' },
    ];
  }

  public async checkCurrentConnection(): Promise<boolean> {
    return false;
  }

  /**
   * Simulates a Bluetooth connection event for demo/testing
   */
  public simulateConnect() {
    console.log('[SDK] Simulating Bluetooth Connection...');
    if (this.onConnect) this.onConnect();
  }

  /**
   * Simulates a Bluetooth disconnection event for demo/testing
   */
  public simulateDisconnect() {
    console.log('[SDK] Simulating Bluetooth Disconnection...');
    if (this.onDisconnect) this.onDisconnect();
  }
}
