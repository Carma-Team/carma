import { BluetoothManager, BluetoothDevice } from './BluetoothManager';
import { TripData, DrivingEventType } from './types';

/**
 * DrivingSDK - Standalone Hardware Facade.
 */
class DrivingSDKManager {
  private static instance: DrivingSDKManager;
  private bluetooth: BluetoothManager;

  public onUpdate?: (data: TripData) => void;
  public onTripEnd?: () => void;
  public onAutoStart?: () => void; // אירוע לניווט אוטומטי

  private constructor() {
    this.bluetooth = new BluetoothManager(
      () => {
        console.log('[DrivingSDK] Event: Auto-Start Triggered');
        this.startTrip();
        if (this.onAutoStart) this.onAutoStart();
      },
      () => {
        console.log('[DrivingSDK] Event: Auto-Stop Triggered');
        this.stopTrip();
      }
    );
  }

  public static getInstance(): DrivingSDKManager {
    if (!DrivingSDKManager.instance) {
      DrivingSDKManager.instance = new DrivingSDKManager();
    }
    return DrivingSDKManager.instance;
  }

  // --- Bluetooth ---

  /**
   * מחזיר את כל המכשירים המשויכים, ממוינים: קודם הזמינים.
   */
  public async getPairedDevices(): Promise<BluetoothDevice[]> {
    return this.bluetooth.getSortedPairedDevices();
  }

  public async updateTargetDevice(deviceId: string | null): Promise<void> {
    await this.bluetooth.setTargetDevice(deviceId);
  }

  public getSelectedDevice(): string | null {
    return this.bluetooth.getTargetDevice();
  }

  // --- Trip Lifecycle ---

  public async startTrip(): Promise<void> {
    if (this.onUpdate) {
      this.onUpdate({
        startTime: new Date(),
        distanceKm: 0,
        durationSeconds: 0,
        events: [],
        averageSpeed: 0,
        maxSpeed: 0
      });
    }
  }

  public async stopTrip(): Promise<void> {
    if (this.onTripEnd) this.onTripEnd();
  }

  public simulateBluetoothConnection() {
    this.bluetooth.simulateConnect();
  }

  public simulateBluetoothDisconnection() {
    this.bluetooth.simulateDisconnect();
  }
}

export const DrivingSDK = DrivingSDKManager.getInstance();
export type { BluetoothDevice, TripData };
export { DrivingEventType };
