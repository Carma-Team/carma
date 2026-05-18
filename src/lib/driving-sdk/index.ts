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

export class CarmaDrivingSDK {
  private config: SDKConfig;
  private btManager: BluetoothManager;
  private sensorManager: SensorManager;
  private phoneManager: PhoneUsageManager;
  private isTripActive: boolean = false;
  private currentTripData: TripData | null = null;
  private timer: any = null;

  // Callbacks
  public onTripStart?: (tripId: string) => void;
  public onTripEnd?: (data: TripData) => void;
  public onEventDetected?: (event: DrivingEvent) => void;
  public onUpdate?: (data: TripData) => void;

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
      (event) => this.handleEvent(event),
      (totalSeconds) => this.handlePhoneSeconds(totalSeconds)
    );

    if (this.config.targetBluetoothId) {
      this.btManager.setTargetDevice(this.config.targetBluetoothId);
    }
  }

  // --- Bluetooth Logic ---

  private async handleBluetoothConnect() {
    if (this.config.autoStartOnBluetooth && !this.isTripActive) {
      console.log('[SDK] Auto-starting trip via Bluetooth');
      await this.startTrip();
    }
  }

  private async handleBluetoothDisconnect() {
    if (this.isTripActive) {
      console.log('[SDK] Auto-ending trip via Bluetooth disconnect');
      await this.stopTrip();
    }
  }

  public updateTargetDevice(deviceId: string | null) {
    this.config.targetBluetoothId = deviceId;
    this.btManager.setTargetDevice(deviceId);
  }

  // --- Trip Control ---

  public async startTrip(): Promise<string> {
    if (this.isTripActive) return 'ALREADY_ACTIVE';

    this.isTripActive = true;
    const tripId = `trip_${Date.now()}`;

    this.currentTripData = {
      startTime: new Date(),
      distanceKm: 0,
      durationSeconds: 0,
      events: [],
      averageSpeed: 0,
      maxSpeed: 0,
      phoneSeconds: 0,
    };

    await this.sensorManager.start();
    this.phoneManager.start();

    this.timer = setInterval(() => {
      if (this.currentTripData) {
        this.currentTripData.durationSeconds += 1;
        if (this.onUpdate) this.onUpdate({ ...this.currentTripData });
      }
    }, 1000);

    if (this.onTripStart) this.onTripStart(tripId);
    return tripId;
  }

  public async stopTrip(): Promise<TripData | null> {
    if (!this.isTripActive || !this.currentTripData) return null;

    this.isTripActive = false;
    if (this.timer) clearInterval(this.timer);

    this.currentTripData.endTime = new Date();
    this.sensorManager.stop();
    this.phoneManager.stop();

    const finalData = { ...this.currentTripData };
    if (this.onTripEnd) this.onTripEnd(finalData);

    this.currentTripData = null;
    return finalData;
  }

  // --- Internal Handlers ---

  private handleEvent(event: DrivingEvent) {
    if (!this.isTripActive || !this.currentTripData) {
      console.warn('[SDK] Event ignored: Trip not active', event.type);
      return;
    }

    // Cooldown logic (only for physical sensors, not for phone usage)
    if (event.type !== DrivingEventType.PHONE_USAGE) {
      const lastEvent = this.currentTripData.events[this.currentTripData.events.length - 1];
      if (lastEvent && (event.timestamp.getTime() - lastEvent.timestamp.getTime() < 3000)) {
        return;
      }
    }

    console.log(`[SDK] Event Recorded: ${event.type}`);
    this.currentTripData.events.push(event);

    if (this.onEventDetected) this.onEventDetected(event);

    // Immediate UI update for events
    if (this.onUpdate) this.onUpdate({ ...this.currentTripData });
  }

  private handlePhoneSeconds(totalSeconds: number) {
    if (!this.isTripActive || !this.currentTripData) return;
    this.currentTripData.phoneSeconds = totalSeconds;
    if (this.onUpdate) this.onUpdate({ ...this.currentTripData });
  }

  private handleSensorUpdate(update: { distanceKm: number, currentSpeed: number }) {
    if (!this.isTripActive || !this.currentTripData) return;

    this.currentTripData.distanceKm += update.distanceKm;
    this.currentTripData.maxSpeed = Math.max(this.currentTripData.maxSpeed, update.currentSpeed);

    const hours = this.currentTripData.durationSeconds / 3600;
    if (hours > 0) {
      this.currentTripData.averageSpeed = this.currentTripData.distanceKm / hours;
    }

    if (this.onUpdate) this.onUpdate({ ...this.currentTripData });
  }

  public async getAvailableDevices() {
    return this.btManager.getBondedDevices();
  }

  public getStatus() {
    return {
      isActive: this.isTripActive,
      tripData: this.currentTripData
    };
  }

  public simulateBluetoothConnection() {
    this.btManager.simulateConnect();
  }

  public simulateBluetoothDisconnection() {
    this.btManager.simulateDisconnect();
  }

  public debugAddDistance(km: number) {
    if (this.isTripActive && this.currentTripData) {
      this.currentTripData.distanceKm += km;
      if (this.onUpdate) this.onUpdate({ ...this.currentTripData });
    }
  }
}


export * from './types';
