/**
 * @fileoverview Generic driving trip SDK — DrivingSDK
 * @module lib/driving-sdk
 *
 * @description
 * Singleton class managing the full trip lifecycle:
 * - Manual and automatic start/end (via Bluetooth)
 * - 1-second wall-clock timer that updates TripData
 * - Sensor event listeners (brake/accel/turn) via SensorManager
 * - Phone usage listener via PhoneUsageManager
 * - Callbacks: onTripStart, onTripEnd, onUpdate, onEventDetected, onAutoStart, onFraudDetected
 *
 * @remarks No server calls — all logic is local. Server persistence happens in AppContext after stopTrip().
 * @see AppContext.processEndTrip — tripsApi.save() is called there after a trip ends
 */
import { BluetoothManager } from '@/lib/driving-sdk/BluetoothManager';
import { SensorManager } from '@/lib/driving-sdk/sensors/SensorManager';
import { PhoneUsageManager } from '@/lib/driving-sdk/sensors/PhoneUsageManager';
import { DefaultTripValidator } from '@/lib/driving-sdk/DefaultTripValidator';
import {
  DrivingEventType, DrivingEvent, SDKConfig, TripData, FraudDetectedEvent,
  SensorEventCondition, SensorEventHandler, ListenerToken,
  TripValidator, SuspiciousActivityEvaluation,
} from '@/lib/driving-sdk/types';

export class DrivingSDK {
  private config: SDKConfig;
  private btManager: BluetoothManager;
  private sensorManager: SensorManager;
  private phoneManager: PhoneUsageManager;
  private validationManager: TripValidator;

  private isTripActive: boolean = false;
  private isValidating: boolean = false;
  private validationStartTime = 0;
  private validationMaxSpeed  = 0;
  private currentTripData: TripData | null = null;
  private timer: any = null;
  // Wall-clock start used to compute durationSeconds — setInterval is throttled by the OS in background.
  private tripStartMs = 0;
  // Wall-clock timestamp of the most recent startTrip() call — used to enforce a 3-second warm-up
  // grace period that drops spurious sensor events caused by the physical act of pressing Start.
  private tripStartTime = 0;
  // Per-type cooldown map — prevents a brake event from suppressing a concurrent turn event
  private lastEventTime: Partial<Record<DrivingEventType, number>> = {};

  // Registered conditional sensor event listeners.
  // Each entry: { type, condition, handler } — dispatched inside handleEvent().
  private sensorListeners = new Map<ListenerToken, {
    type: DrivingEventType;
    condition: SensorEventCondition;
    handler: SensorEventHandler;
  }>();
  // Latest GPS speed tick — stamped onto every DrivingEvent for kinetic penalty scaling
  private currentSpeedKmh = 0;
  // Last known GPS coordinates — stamped onto DrivingEvents so event markers can be placed on the map
  private lastKnownLocation: { lat: number; lng: number } | null = null;
  // Elapsed seconds since the last waypoint was appended — used for 5-second time-based downsampling
  private secondsSinceLastWaypoint = 0;

  // ─── Trip lifecycle callbacks ────────────────────────────────────────────────
  public onTripStart?: (tripId: string) => void;
  public onTripEnd?: (data: TripData) => void;
  /** Fires for every SDK-qualified sensor event, regardless of registered listener conditions.
   *  Useful for raw display (e.g. live event counter). For conditional business logic use `on()`. */
  public onEventDetected?: (event: DrivingEvent) => void;
  public onUpdate?: (data: TripData) => void;
  // TODO: Mai — show "public transport trip detected" toast/modal when this fires
  public onFraudDetected?: (event: FraudDetectedEvent) => void;

  // ─── Conditional sensor event subscription API ───────────────────────────────

  /**
   * Subscribe to a sensor event type with optional conditions.
   * The handler fires only when ALL specified conditions are satisfied.
   *
   * @param type    - The event type to listen for.
   * @param condition - Conditions that must hold at detection time (speed, severity, …).
   * @param handler - Callback invoked with a copy of the event when conditions are met.
   * @returns A `ListenerToken` — pass to `off()` to unsubscribe.
   *
   * @example
   * // Fire only for hard brakes detected above 15 km/h
   * const token = sdk.on(DrivingEventType.HARD_BRAKE, { minSpeedKmh: 15 }, (event) => {
   *   console.log('Hard brake at', event.speedKmh, 'km/h — severity', event.severity);
   * });
   */
  public on(
    type: DrivingEventType,
    condition: SensorEventCondition,
    handler: SensorEventHandler,
  ): ListenerToken {
    const token: ListenerToken = Symbol('sensor-listener');
    this.sensorListeners.set(token, { type, condition, handler });
    return token;
  }

  /** Remove a previously registered listener. No-op if the token is unknown. */
  public off(token: ListenerToken): void {
    this.sensorListeners.delete(token);
  }

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
      (update) => this.handleSensorUpdate(update),
      config.motionThresholds,
      // Share SensorManager's gyroscope rather than letting PhoneUsageManager open a
      // second subscription to the same sensor.
      ({ x, y, z }) => this.phoneManager.pushGyroSample(x, y, z),
    );

    this.phoneManager = new PhoneUsageManager(
      (event) => this.handleEvent(event),
      (data) => this.handleInteractionData(data),
    );

    this.validationManager = config.tripValidator ?? new DefaultTripValidator();
    this.validationManager.onTripConfirmed = () => {
      this.isValidating = false;
      this.startTrip();
    };
    this.validationManager.onTripEnded = () => this.stopTrip();
    this.validationManager.onFraudSuspected = (evaluation) =>
      this.handleFraud(evaluation);

    if (this.config.targetBluetoothId) {
      this.btManager.setTargetDevice(this.config.targetBluetoothId);
      this.btManager.startMonitoring();
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
    console.log('[SDK] BT disconnected — validating:', this.isValidating, '| trip active:', this.isTripActive);

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
    if (deviceId) {
      this.btManager.startMonitoring();
    } else {
      this.btManager.stopMonitoring();
    }
  }

  // --- Trip Control ---

  public async startTrip(): Promise<string> {
    if (this.isTripActive) return 'ALREADY_ACTIVE';
    // Set before validationManager.start() below: a TripValidator (e.g.
    // DefaultTripValidator) may call onTripConfirmed synchronously from within
    // start(), which re-enters startTrip() while it's still on the stack. This
    // guard must already read true at that point, or the re-entrant call runs
    // the whole method again — duplicate currentTripData, duplicate onTripStart,
    // and a leaked setInterval (stopTrip only ever clears the last one).
    this.isTripActive = true;

    // Manual trip start: BT-triggered trips already started the validator in handleBluetoothConnect.
    // Without this, users on trains who start manually bypass fraud detection entirely (D-FRAUD-3).
    if (!this.isValidating) {
      this.isValidating = true;
      this.validationStartTime = Date.now();
      this.validationMaxSpeed = 0;
      await this.sensorManager.start();
      this.validationManager.start();
    }

    this.lastEventTime = {};
    this.tripStartMs = Date.now();
    this.tripStartTime = Date.now();
    this.lastKnownLocation = null;
    this.secondsSinceLastWaypoint = 0;
    const tripId = `trip_${Date.now()}`;

    this.currentTripData = {
      startTime: new Date(),
      distanceKm: 0,
      durationSeconds: 0,
      events: [],
      waypoints: [],
      averageSpeed: 0,
      maxSpeed: 0,
      phoneSeconds: 0,           // deprecated v1.7
      touchEpochs: 0,
      screenInteractionSeconds: 0,
    };

    // SensorManager may already be running (started during validation phase)
    await this.sensorManager.start();
    this.phoneManager.start();

    this.timer = setInterval(() => {
      if (this.currentTripData) {
        // Use wall-clock elapsed time — setInterval is throttled in background on iOS/Android,
        // causing durationSeconds to lag behind real time and inflating averageSpeed (D-SDK-5).
        this.currentTripData.durationSeconds = Math.floor((Date.now() - this.tripStartMs) / 1000);
        if (this.onUpdate) this.onUpdate({ ...this.currentTripData });
      }
    }, 1000);

    if (this.onTripStart) this.onTripStart(tripId);
    return tripId;
  }

  public async stopTrip(): Promise<TripData | null> {
    if (!this.isTripActive || !this.currentTripData) return null;

    this.isTripActive = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }

    this.currentTripData.endTime = new Date();
    // The validator outlives the trip unless it is stopped here — its ticker keeps running on
    // the last speed it saw, and start() early-returns while that ticker is alive, so the next
    // session inherits this one's state instead of resetting.
    this.validationManager.stop();
    this.isValidating = false;
    this.sensorManager.stop();
    this.phoneManager.stop();

    const finalData = { ...this.currentTripData };
    if (this.onTripEnd) this.onTripEnd(finalData);

    this.currentTripData = null;
    this.tripStartTime = 0;
    this.lastKnownLocation = null;
    this.secondsSinceLastWaypoint = 0;
    return finalData;
  }

  // --- Fraud Handling ---

  private handleFraud(evaluation: SuspiciousActivityEvaluation): void {
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

    // 3-second warm-up guard: drops spurious sensor spikes caused by the physical
    // motion of the user pressing "Start Trip" (picking up phone, tapping screen).
    const WARMUP_MS = 3000;
    if (Date.now() - this.tripStartTime < WARMUP_MS) return;

    // Per-type cooldown — spec §א Table 1: minimum time between events = 0.5 s.
    // Recommended for less sensitivity: raise IMU cooldowns to 2–3 s.
    // EVT_SWERVE had a 3 s cooldown but is currently disabled.
    if (event.type !== DrivingEventType.PHONE_USAGE) {
      const cooldownMs = 500;
      const last = this.lastEventTime[event.type] ?? 0;
      if (event.timestamp.getTime() - last < cooldownMs) return;
      this.lastEventTime[event.type] = event.timestamp.getTime();
    }

    // Stamp GPS speed and location onto the event.
    event.speedKmh = this.currentSpeedKmh;
    if (this.lastKnownLocation) {
      event.location = { latitude: this.lastKnownLocation.lat, longitude: this.lastKnownLocation.lng };
    }

    // Store all SDK-qualified events in the trip (used for route map markers and raw display).
    // Whether an event counts toward a score is decided by each registered listener's conditions.
    this.currentTripData.events.push(event);
    console.log(`[SDK] Event: ${event.type} speed=${Math.round(this.currentSpeedKmh)} km/h severity=${event.severity?.toFixed(2)}`);

    // Dispatch to conditional listeners — each listener fires only when its conditions are met.
    const snapshot = { ...event };
    for (const { type, condition, handler } of this.sensorListeners.values()) {
      if (type !== event.type) continue;
      if (condition.minSpeedKmh !== undefined && this.currentSpeedKmh < condition.minSpeedKmh) continue;
      if (condition.minSeverity !== undefined && (event.severity ?? 0) < condition.minSeverity) continue;
      try { handler(snapshot); } catch (e) { console.warn('[SDK] Listener threw:', e); }
    }

    // Legacy single callback — fires for every SDK-qualified event regardless of conditions.
    if (this.onEventDetected) this.onEventDetected(snapshot);

    if (this.onUpdate) this.onUpdate({ ...this.currentTripData });
  }

  private handleInteractionData(data: { touchEpochs: number; screenInteractionSeconds: number }) {
    if (!this.isTripActive || !this.currentTripData) return;
    this.currentTripData.touchEpochs = data.touchEpochs;
    this.currentTripData.screenInteractionSeconds = data.screenInteractionSeconds;
    if (this.onUpdate) this.onUpdate({ ...this.currentTripData });
  }

  private handleSensorUpdate(update: { distanceKm: number; currentSpeed: number; timeDeltaS: number; accelX: number; gyroZ: number; lat?: number; lng?: number }) {
    // Track peak speed across the whole session (validation + scoring) for fraud payload
    this.validationMaxSpeed = Math.max(this.validationMaxSpeed, update.currentSpeed);
    this.currentSpeedKmh = update.currentSpeed;
    // PhoneUsageManager has no speed source of its own — it reports handling, and the
    // speed it happened at travels with it.
    this.phoneManager.updateSpeed(update.currentSpeed);

    // Keep last known location for event stamping
    if (update.lat !== undefined && update.lng !== undefined) {
      this.lastKnownLocation = { lat: update.lat, lng: update.lng };
    }

    // Always feed sensor data to TripValidationManager (works in both phases)
    this.validationManager.updateSample({
      speedKmh: update.currentSpeed,
      timestamp: Date.now(),
      accel: { x: update.accelX, y: 0, z: 0 },
      gyroYaw: update.gyroZ,
    });

    if (!this.isTripActive || !this.currentTripData) return;

    // Gate: ignore GPS ticks below 3 km/h — coordinate jitter when stationary otherwise
    // accumulates phantom distance via Haversine (D-SDK-3).
    if (update.currentSpeed >= 3) {
      // Teleportation guard: GPS position jumps (network-location multipath or brief
      // satellite loss) can produce a Haversine distance far larger than the reported
      // Doppler speed implies. Cap each tick's contribution to 1.5× what is physically
      // achievable at the reported speed over the measured GPS interval.
      // Example: speed=5 km/h, Δt=2 s → max 5/3.6×2×1.5 = 4.2 m per tick.
      const maxDistKm = (update.currentSpeed / 3600) * update.timeDeltaS * 1.5;
      this.currentTripData.distanceKm += Math.min(update.distanceKm, maxDistKm);

      // Waypoint collection: append one point every 5 elapsed GPS seconds while moving.
      // This caps a 30-minute trip at ~360 waypoints regardless of speed.
      this.secondsSinceLastWaypoint += 2; // GPS fires every ~2s
      if (this.secondsSinceLastWaypoint >= 5 && this.lastKnownLocation) {
        this.currentTripData.waypoints.push({
          lat: this.lastKnownLocation.lat,
          lng: this.lastKnownLocation.lng,
          ts: Date.now(),
          speedKmh: update.currentSpeed,
        });
        this.secondsSinceLastWaypoint = 0;
      }
    }
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

  public async getBTSupportStatus() {
    return this.btManager.getBTSupportStatus();
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
