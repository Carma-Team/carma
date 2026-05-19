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
 * - Callbacks: onTripStart, onTripEnd, onUpdate, onEventDetected, onAutoStart, onFraudDetected
 *
 * @remarks ללא קריאות שרת — כל הלוגיקה מקומית. השמירה לשרת מתבצעת ב-AppContext אחרי stopTrip().
 * @see AppContext.processEndTrip — שם מתבצע tripsApi.save() לאחר סיום נסיעה
 */
import { BluetoothManager } from '@/lib/driving-sdk/BluetoothManager';
import { SensorManager } from '@/lib/driving-sdk/sensors/SensorManager';
import { PhoneUsageManager } from '@/lib/driving-sdk/sensors/PhoneUsageManager';
import { TripValidationManager } from '@/lib/driving-sdk/TripValidationManager';
import { DrivingEventType, DrivingEvent, SDKConfig, TripData, FraudDetectedEvent } from '@/lib/driving-sdk/types';
import type { FraudEvaluation } from '@/lib/driving-sdk/FraudDetector';

export class CarmaDrivingSDK {
  private config: SDKConfig;
  private btManager: BluetoothManager;
  private sensorManager: SensorManager;
  private phoneManager: PhoneUsageManager;
  private validationManager: TripValidationManager;

  private isTripActive: boolean = false;
  private isValidating: boolean = false;
  private validationStartTime = 0;
  private validationMaxSpeed  = 0;
  private currentTripData: TripData | null = null;
  private timer: any = null;
  // Per-type cooldown map — prevents a brake event from suppressing a concurrent turn event
  private lastEventTime: Partial<Record<DrivingEventType, number>> = {};

  // Callbacks
  public onTripStart?: (tripId: string) => void;
  public onTripEnd?: (data: TripData) => void;
  public onEventDetected?: (event: DrivingEvent) => void;
  public onUpdate?: (data: TripData) => void;
  // AppContext wires this to reset trip state + call fraudApi.syncInvalidTrip()
  // Mai: show "נסיעה בתחבורה ציבורית זוהתה" toast/modal when this fires
  public onFraudDetected?: (event: FraudDetectedEvent) => void;

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

    this.validationManager = new TripValidationManager();
    this.validationManager.onTripConfirmed = () => {
      this.isValidating = false;
      this.startTrip();
    };
    this.validationManager.onTripEnded = () => this.stopTrip();
    this.validationManager.onFraudSuspected = (evaluation) =>
      this.handleFraud(evaluation);

    if (this.config.targetBluetoothId) {
      this.btManager.setTargetDevice(this.config.targetBluetoothId);
    }
  }

  // --- Bluetooth Logic ---

  private async handleBluetoothConnect() {
    if (!this.config.autoStartOnBluetooth || this.isTripActive || this.isValidating) return;

    console.log('[SDK] BT connected — starting trip validation');
    this.isValidating = true;
    this.validationStartTime = Date.now();
    this.validationMaxSpeed  = 0;

    // Sensors must run during validation so TripValidationManager receives speed data.
    // SensorManager.start() is idempotent — safe to call again when startTrip() fires.
    await this.sensorManager.start();
    this.validationManager.start();
  }

  private async handleBluetoothDisconnect() {
    if (this.isValidating) {
      this.validationManager.stop();
      this.sensorManager.stop();
      this.isValidating = false;
    }
    if (this.isTripActive) {
      this.validationManager.stop();
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
    this.lastEventTime = {};
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

    // SensorManager may already be running (started during validation phase)
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

  // --- Fraud Handling ---

  private handleFraud(evaluation: FraudEvaluation): void {
    console.log(`[SDK] Fraud: ${evaluation.mode} at ${Math.round(evaluation.score * 100)}% — aborting session`);
    this.isValidating = false;

    // Silently abort — do NOT fire onTripEnd so AppContext won't persist the trip
    this.isTripActive = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.currentTripData = null;
    this.sensorManager.stop();
    this.phoneManager.stop();

    // Delegate server sync + UI to AppContext via onFraudDetected
    const event: FraudDetectedEvent = {
      confidence: evaluation.score,
      mode: evaluation.mode,
      telemetry: evaluation.telemetry,
      durationMs: Date.now() - this.validationStartTime,
      maxSpeedKmh: this.validationMaxSpeed,
    };
    this.onFraudDetected?.(event);
  }

  // --- Internal Handlers ---

  private handleEvent(event: DrivingEvent) {
    if (!this.isTripActive || !this.currentTripData) {
      console.warn('[SDK] Event ignored: Trip not active', event.type);
      return;
    }

    // Per-type cooldown: each event type has an independent 3s suppression window.
    // Replaces the old global cooldown that incorrectly silenced e.g. a SHARP_TURN
    // occurring within 3s of a HARD_BRAKE (two distinct concurrent physical events).
    if (event.type !== DrivingEventType.PHONE_USAGE) {
      const last = this.lastEventTime[event.type] ?? 0;
      if (event.timestamp.getTime() - last < 3000) return;
      this.lastEventTime[event.type] = event.timestamp.getTime();
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

  private handleSensorUpdate(update: { distanceKm: number; currentSpeed: number; accelX: number; gyroZ: number }) {
    // Track peak speed across the whole session (validation + scoring) for fraud payload
    this.validationMaxSpeed = Math.max(this.validationMaxSpeed, update.currentSpeed);

    // Always feed sensor data to TripValidationManager (works in both phases)
    this.validationManager.updateSample({
      speedKmh: update.currentSpeed,
      timestamp: Date.now(),
      accel: { x: update.accelX, y: 0, z: 0 },
      gyroYaw: update.gyroZ,
    });

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
      isValidating: this.isValidating,
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
