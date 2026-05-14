/**
 * @fileoverview ה-SDK המרכזי לניהול נסיעות — CarmaDrivingSDK
 * @module lib/driving-sdk
 *
 * @description
 * מחלקה יחידנית (Singleton) שמנהלת את מחזור חיי הנסיעה:
 * - התחלה/סיום ידני ואוטומטי (דרך Bluetooth)
 * - טיימר רץ שמעדכן את TripData כל שנייה
 * - האזנה לאירועי חיישנים (בלימה/האצה/פנייה) דרך SensorManager
 * - האזנה לשימוש בטלפון דרך PhoneUsageManager
 * - Callbacks: onTripStart, onTripEnd, onUpdate, onEventDetected, onAutoStart
 *
 * @remarks ללא קריאות שרת — כל הלוגיקה מקומית. השמירה לשרת מתבצעת ב-AppContext אחרי stopTrip().
 * @see AppContext.processEndTrip — שם מתבצע tripsApi.save() לאחר סיום נסיעה
 */
import { BluetoothManager } from '@/lib/driving-sdk/BluetoothManager';
import { SensorManager } from '@/lib/driving-sdk/sensors/SensorManager';
import { PhoneUsageManager } from '@/lib/driving-sdk/sensors/PhoneUsageManager';
import { DrivingEventType, DrivingEvent, SDKConfig, TripData } from '@/lib/driving-sdk/types';

/**
 * DrivingSDK - Standalone Hardware Facade.
 */
class DrivingSDKManager {
  private static instance: DrivingSDKManager;
  private bluetooth: BluetoothManager;

  public onUpdate?: (data: TripData) => void;
  public onAutoStart?: () => void;

  constructor(config: SDKConfig = {}) {
    this.config = {
      autoStartOnBluetooth: true,
      sensorUpdateInterval: 1000,
      scoringEnabled: true,
      ...config
    };

    this.btManager = new BluetoothManager(
      () => this.handleBluetoothConnect(),
      () => this.handleBluetoothDisconnect()
    );

    this.sensorManager = new SensorManager(
      (event) => this.handleEvent(event),
      (update) => this.handleSensorUpdate(update)
    );

    this.phoneManager = new PhoneUsageManager(
      (event) => this.handleEvent(event)
    );
  }

  // --- Bluetooth Logic ---

  private async handleBluetoothConnect() {
    if (this.config.autoStartOnBluetooth && !this.isTripActive) {
      console.log('[SDK] Auto-starting trip via Bluetooth');
      await this.startTrip();
      if (this.onAutoStart) this.onAutoStart();
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


export * from './types';

/** Singleton instance used by AppContext */
export const DrivingSDK = new CarmaDrivingSDK();
