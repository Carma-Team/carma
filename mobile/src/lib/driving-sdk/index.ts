/**
 * @file index.ts
 * @owner May Hajbi — driving-sdk maintainer
 * @brief The SDK's public entry point and orchestrator, `DrivingSDK`.
 * Owns the trip lifecycle, accumulates distance/speed/waypoints from the sensor stream,
 * and emits driving events to whatever host app is consuming the library.
 *
 * @description
 * Singleton class managing the full trip lifecycle:
 * - Manual and automatic start/end (automatic via the platform's trip-detection strategy)
 * - 1-second wall-clock timer that updates TripData
 * - Sensor event listeners (brake/accel/turn) via SensorManager
 * - Phone usage listener via PhoneUsageManager
 * - Callbacks: onTripStart, onTripEnd, onUpdate, onEventDetected, onFraudDetected
 *
 * @remarks No server calls — all logic is local. Server persistence happens in AppContext after stopTrip().
 * @see AppContext.processEndTrip — tripsApi.save() is called there after a trip ends
 */
import { AutoDriveModeManager } from '@/lib/driving-sdk/auto-trip-detection/AutoDriveModeManager';
import { getBondedDevices, getBTSupportStatus } from '@/lib/driving-sdk/auto-trip-detection/bluetoothDevices';
import { SensorManager } from '@/lib/driving-sdk/sensors/SensorManager';
import { PhoneUsageManager, InteractionData } from '@/lib/driving-sdk/sensors/PhoneUsageManager';
import { RawSampleRecorder } from '@/lib/driving-sdk/sensors/RawSampleRecorder';
import { DefaultTripValidator } from '@/lib/driving-sdk/DefaultTripValidator';
import {
  DrivingEventType, DrivingEvent, SDKConfig, TripData, FraudDetectedEvent,
  SensorEventCondition, SensorEventHandler, ListenerToken,
  TripValidator, SuspiciousActivityEvaluation, SensorUpdate, RawExportFailure,
} from '@/lib/driving-sdk/types';

// The server re-detects a brake as the average deceleration between two consecutive
// waypoints, so the sampling interval cannot exceed the event it has to catch: a hard
// brake lasts ~2 s. At 5 s it needs a 54 km/h drop between two points to register one,
// where a real hard brake is ~25 km/h (CAR-179 derives this from the 3.0 m/s² threshold).
// Costs no battery — the location stream is already requested at 2 s and thinning only
// discards fixes already paid for.
const WAYPOINT_INTERVAL_MS = 2000;

export class DrivingSDK {
  private config: SDKConfig;
  private autoDetection: AutoDriveModeManager;
  private sensorManager: SensorManager;
  private phoneManager: PhoneUsageManager;
  // Staged-calibration recording (CAR-31) — independent of trip lifecycle, never
  // wired into startTrip/stopTrip. Feeds the labelled-drive-data collection Dan's
  // k-refit needs (scoring.md §3.5), not any real trip.
  private rawRecorder = new RawSampleRecorder();
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
  // Wall-clock timestamp of the last appended waypoint — used for time-based downsampling
  private lastWaypointTs: number | null = null;

  // ─── Trip lifecycle callbacks ────────────────────────────────────────────────
  public onTripStart?: (tripId: string) => void;
  public onTripEnd?: (data: TripData) => void;
  /** Fires for every SDK-qualified sensor event, regardless of registered listener conditions.
   *  Useful for raw display (e.g. live event counter). For conditional business logic use `on()`. */
  public onEventDetected?: (event: DrivingEvent) => void;
  public onUpdate?: (data: TripData) => void;
  /** Per-second interaction sample, stamped with the speed observed for that second.
   *  Passed through untouched — the library applies no speed gate, because what a speed
   *  means for a second of handling is the host's decision, not the library's.
   *  `TripData.screenInteractionSeconds` is the ungated sum of the same stream. */
  public onInteractionData?: (data: InteractionData) => void;
  // TODO: Mai — show "public transport trip detected" toast/modal when this fires
  public onFraudDetected?: (event: FraudDetectedEvent) => void;
  // CAR-23: fires when a trip is silently rejected for starting outside Israel.
  public onRegionRejected?: () => void;

  // ─── Conditional sensor event subscription API ───────────────────────────────

  /**
   * Subscribe to a sensor event type with optional conditions.
   * The handler fires only when ALL specified conditions are satisfied.
   *
   * @param type    - The event type to listen for.
   * @param condition - Conditions that must hold at detection time (speed; severity, PHONE_USAGE only, see CAR-156).
   * @param handler - Callback invoked with a copy of the event when conditions are met.
   * @returns A `ListenerToken` — pass to `off()` to unsubscribe.
   *
   * @example
   * // Fire only for hard brakes detected above 15 km/h
   * const token = sdk.on(DrivingEventType.HARD_BRAKE, { minSpeedKmh: 15 }, (event) => {
   *   console.log('Hard brake at', event.speedKmh, 'km/h');
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
      ...config
    };

    this.autoDetection = new AutoDriveModeManager(
      () => this.handleDriveDetected(),
      () => this.handleDriveLost()
    );

    this.sensorManager = new SensorManager(
      (event) => this.handleEvent(event),
      (update) => this.handleSensorUpdate(update),
      config.motionThresholds,
      // Share SensorManager's gyroscope rather than letting PhoneUsageManager (and,
      // during a staged session, rawRecorder) open a second subscription to the same sensor.
      ({ x, y, z }) => {
        this.phoneManager.pushGyroSample(x, y, z);
        this.rawRecorder.pushGyroSample(x, y, z);
      },
      ({ x, y, z }) => this.rawRecorder.pushAccelSample(x, y, z),
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
    this.validationManager.onRegionRejected = () => this.handleRegionRejected();

    if (this.config.targetBluetoothId) {
      this.autoDetection.enable(this.config.targetBluetoothId);
    }
  }

  // --- Automatic trip detection ---
  // Fired by whichever TripDetectionStrategy the platform selected. Neither handler knows
  // what noticed the vehicle — on Android a Bluetooth connect, on iOS eventually movement.

  private async handleDriveDetected() {
    if (!this.config.autoStartOnBluetooth || this.isTripActive || this.isValidating) return;

    console.log('[SDK] Vehicle travel detected — starting trip validation');
    this.isValidating = true;
    this.validationStartTime = Date.now();
    this.validationMaxSpeed  = 0;

    // Sensors must run during validation so the configured TripValidator receives speed data.
    // SensorManager.start() is idempotent — safe to call again when startTrip() fires.
    await this.sensorManager.start();
    this.validationManager.start();
  }

  private async handleDriveLost() {
    console.log('[SDK] Detection signal lost — validating:', this.isValidating, '| trip active:', this.isTripActive);

    if (this.isValidating) {
      this.validationManager.stop();
      // Same raw-recording guard as stopTrip() — a staged session may still be running.
      if (!this.rawRecorder.isRecording()) this.sensorManager.stop();
      this.isValidating = false;
    }
    if (this.isTripActive) {
      this.validationManager.stop();
      await this.stopTrip();
    }
  }

  public updateTargetDevice(deviceId: string | null) {
    // Kept in step, not read: the active strategy owns the target from here on. A config
    // field that silently stopped matching what detection watches is the worse of the two.
    this.config.targetBluetoothId = deviceId;
    this.autoDetection.enable(deviceId);
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

    // Manual trip start: automatically detected trips already started the validator in handleDriveDetected.
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
    this.lastWaypointTs = null;
    const tripId = `trip_${Date.now()}`;

    this.currentTripData = {
      startTime: new Date(),
      distanceKm: 0,
      durationSeconds: 0,
      events: [],
      waypoints: [],
      averageSpeed: 0,
      maxSpeed: 0,
      touchEpochs: 0,
      screenInteractionSeconds: 0,
      // Latched over the trip: `accelAvailable` on each tick is "live right now"
      // (available at start() and a sample within SENSOR_STALE_MS), so it can drop to
      // false mid-trip. These default false and latch true once the accelerometer is
      // ever confirmed live this trip (CAR-189).
      accelAvailable: false,
      accelCoverage: 0,
      accelInitFailed: false,
    };

    // SensorManager may already be running (started during validation phase)
    await this.sensorManager.start();
    // Coverage has to describe the trip, not the wait in front of it. On a BT-triggered
    // trip the sensors have been running since validation opened, and start() above is a
    // no-op then — so the window is restarted here, where the trip actually begins.
    this.sensorManager.resetSensorCoverage();
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
    // A staged raw-recording session (CAR-31) may be running independently of this trip
    // — stopping sensors here would truncate it silently. Same guard as stopRawRecording().
    if (!this.rawRecorder.isRecording()) this.sensorManager.stop();
    this.phoneManager.stop();

    const finalData = { ...this.currentTripData };
    if (this.onTripEnd) this.onTripEnd(finalData);

    this.currentTripData = null;
    this.tripStartTime = 0;
    this.lastKnownLocation = null;
    this.lastWaypointTs = null;
    return finalData;
  }

  // --- Fraud Handling ---

  // Teardown shared by the two silent aborts (fraud, region): same shape as stopTrip()
  // minus the trip payload, since neither fires onTripEnd and neither has anything to
  // persist. Stopping the validator is the part that is easy to forget and expensive to
  // miss — its 1 Hz ticker outlives the session otherwise, and start() early-returns
  // while that ticker is alive, so the next trip inherits this one's state.
  private abortSession(): void {
    this.isValidating = false;
    this.isTripActive = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.validationManager.stop();
    this.currentTripData = null;
    // A staged raw-recording session (CAR-31) may be running independently of this trip
    // — stopping sensors here would truncate it silently. Same guard as stopTrip().
    if (!this.rawRecorder.isRecording()) this.sensorManager.stop();
    this.phoneManager.stop();
  }

  private handleFraud(evaluation: SuspiciousActivityEvaluation): void {
    console.log(`[SDK] Fraud: ${evaluation.mode} at ${Math.round(evaluation.score * 100)}% — aborting session`);

    // Read before the abort clears it below — undefined here means the pre-trip gate
    // caught the session, and stays undefined all the way to the server.
    const distanceKm = this.currentTripData?.distanceKm;

    this.abortSession();

    // Delegate server sync + UI to AppContext via onFraudDetected
    const event: FraudDetectedEvent = {
      fraudScore: evaluation.score,
      detectedMode: evaluation.mode,
      telemetry: evaluation.telemetry,
      signals: evaluation.signals,
      durationMs: Date.now() - this.validationStartTime,
      maxSpeedKmh: this.validationMaxSpeed,
      distanceKm,
    };
    this.onFraudDetected?.(event);
  }

  // CAR-23: no event payload, since there's nothing to report and no server call for
  // a region rejection.
  private handleRegionRejected(): void {
    console.log('[SDK] Region check failed — aborting session');
    this.abortSession();
    this.onRegionRejected?.();
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
    // severity is PHONE_USAGE-only since CAR-156 — omit the suffix on motion events instead of logging "severity=undefined".
    const severitySuffix = event.severity !== undefined ? ` severity=${event.severity.toFixed(2)}` : '';
    console.log(`[SDK] Event: ${event.type} speed=${Math.round(this.currentSpeedKmh)} km/h${severitySuffix}`);

    // Dispatch to conditional listeners — each listener fires only when its conditions are met.
    const snapshot = { ...event };
    for (const { type, condition, handler } of this.sensorListeners.values()) {
      if (type !== event.type) continue;
      if (condition.minSpeedKmh !== undefined && this.currentSpeedKmh < condition.minSpeedKmh) continue;
      // severity only exists on PHONE_USAGE (CAR-156) — minSeverity is not a filter
      // motion events can satisfy, so it must not silently block them either.
      if (condition.minSeverity !== undefined && event.type === DrivingEventType.PHONE_USAGE
          && (event.severity ?? 0) < condition.minSeverity) continue;
      try { handler(snapshot); } catch (e) { console.warn('[SDK] Listener threw:', e); }
    }

    // Legacy single callback — fires for every SDK-qualified event regardless of conditions.
    if (this.onEventDetected) this.onEventDetected(snapshot);

    if (this.onUpdate) this.onUpdate({ ...this.currentTripData });
  }

  private handleInteractionData(data: InteractionData) {
    if (!this.isTripActive || !this.currentTripData) return;
    this.currentTripData.touchEpochs += data.touchEpochs;
    this.currentTripData.screenInteractionSeconds += data.screenInteractionSeconds;
    if (this.onInteractionData) this.onInteractionData({ ...data });
    if (this.onUpdate) this.onUpdate({ ...this.currentTripData });
  }

  private handleSensorUpdate(update: SensorUpdate) {
    // Track peak speed across the whole session (validation + scoring) for fraud payload
    this.validationMaxSpeed = Math.max(this.validationMaxSpeed, update.currentSpeed);
    this.currentSpeedKmh = update.currentSpeed;
    // PhoneUsageManager has no speed source of its own — it reports handling, and the
    // speed it happened at travels with it.
    this.phoneManager.updateSpeed(update.currentSpeed);

    // Keep last known location for event stamping
    if (update.lat !== undefined && update.lng !== undefined) {
      this.lastKnownLocation = { lat: update.lat, lng: update.lng };
      // Every GPS fix, unthinned — waypoints below downsample for TripData, this doesn't.
      this.rawRecorder.pushLocationSample(update.lat, update.lng, update.currentSpeed, update.accuracy ?? null);
    }

    // Always feed sensor data to the validator (works in both phases)
    this.validationManager.updateSample({
      speedKmh: update.currentSpeed,
      timestamp: Date.now(),
      longitudinalAccelG: update.longitudinalAccelG,
      lateralAccelG: update.lateralAccelG,
      yawRate: update.yawRateRadS,
      lat: update.lat,
      lng: update.lng,
      accelAvailable: update.accelAvailable,
      gyroAvailable: update.gyroAvailable,
      backgroundLocationAvailable: update.backgroundLocationAvailable,
    });

    if (!this.isTripActive || !this.currentTripData) return;

    // Trip-level IMU health, carried into the save payload so the server can tell a
    // quiet drive from a dead sensor (CAR-189) — not fraud input, just plumbed through.
    // Latch, never reset: a healthy accelerometer that goes stale in the last seconds of
    // a trip must not arrive as `false`, which is the signature of missing hardware.
    this.currentTripData.accelAvailable ||= update.accelAvailable;
    // Not latched, unlike the flag above: this one is a running share of the trip so
    // far, and the freshest reading is the whole point of it.
    this.currentTripData.accelCoverage = update.accelCoverage;
    this.currentTripData.accelInitFailed = update.accelInitFailed;

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

      // Waypoint collection: one point per WAYPOINT_INTERVAL_MS, measured between the GPS
      // fixes themselves. Android defers location updates under Doze and releases them as a
      // batch in one JS turn, where arrival time barely moves — thinning against it collapses
      // the whole deferred window into a single point and stamps every point in the batch
      // with the same instant (CAR-178). A monotonic clock shares that flaw for the same
      // reason: it measures arrival. What fix time costs instead is exposure to a clock step,
      // so a negative gap re-anchors rather than stalling collection for the rest of the trip.
      // Ticks with no fix behind them carry no position and cannot seed a waypoint anyway.
      const fixTs = update.fixTs ?? Date.now();
      const sinceLastMs = this.lastWaypointTs === null ? Infinity : fixTs - this.lastWaypointTs;
      if (this.lastKnownLocation && (sinceLastMs >= WAYPOINT_INTERVAL_MS || sinceLastMs < 0)) {
        this.currentTripData.waypoints.push({
          lat: this.lastKnownLocation.lat,
          lng: this.lastKnownLocation.lng,
          ts: fixTs,
          speedKmh: update.currentSpeed,
        });
        this.lastWaypointTs = fixTs;
      }
    }
    this.currentTripData.maxSpeed = Math.max(this.currentTripData.maxSpeed, update.currentSpeed);

    const hours = this.currentTripData.durationSeconds / 3600;
    if (hours > 0) {
      this.currentTripData.averageSpeed = this.currentTripData.distanceKm / hours;
    }

    if (this.onUpdate) this.onUpdate({ ...this.currentTripData });
  }

  // Bluetooth-specific, and deliberately not routed through the strategy: a settings screen
  // asking "which devices can I pick" is asking about Bluetooth, not about whatever the
  // active strategy happens to be. Both already answer empty/false off Android.
  public async getAvailableDevices() {
    return getBondedDevices();
  }

  public async getBTSupportStatus() {
    return getBTSupportStatus();
  }

  public getStatus() {
    return {
      isActive: this.isTripActive,
      isValidating: this.isValidating,
      tripData: this.currentTripData
    };
  }

  // Drive the auto-start/auto-end flow without a physical device. They call the handlers
  // directly rather than going through the strategy: faking the trigger is a debugging need
  // of the SDK, not behaviour every strategy should have to implement.
  public simulateBluetoothConnection() {
    this.handleDriveDetected();
  }

  public simulateBluetoothDisconnection() {
    this.handleDriveLost();
  }

  public debugAddDistance(km: number) {
    if (this.isTripActive && this.currentTripData) {
      this.currentTripData.distanceKm += km;
      if (this.onUpdate) this.onUpdate({ ...this.currentTripData });
    }
  }

  // ─── Calibration recording (CAR-31) ──────────────────────────────────────────
  // Records the raw accel/gyro/GPS stream for a staged session — phone handheld,
  // on-seat, in-pocket, mounted — independent of any real trip. Not a trip: works
  // whether or not startTrip() was ever called, and never touches currentTripData.

  /** Starts a staged recording session, tagged with a caller-supplied scenario/platform label. */
  public async startRawRecording(scenario: string, platform: string): Promise<void> {
    await this.sensorManager.start(); // idempotent — no-op if a real trip already has it running
    try {
      this.rawRecorder.start(scenario, platform);
    } catch (e) {
      // start() creates the session file up front, so it can throw on a storage failure
      // after the sensors are already streaming. Without this the caller sees a failed
      // start while GPS and IMU keep running with nothing left to stop them. Same
      // two-flag check as stopRawRecording — a real trip keeps its sensors.
      if (!this.isTripActive && !this.isValidating) this.sensorManager.stop();
      throw e;
    }
  }

  /**
   * Ends the staged session and flushes it to disk. Leaves sensors running if a real trip
   * is active or validating. Rejects if the final write fails — the session keeps recording
   * in that case, so the caller can retry instead of exporting a truncated file.
   */
  public async stopRawRecording(): Promise<void> {
    await this.rawRecorder.stop();
    // An automatically started trip may be mid-validation (isValidating, before isTripActive
    // flips) when a calibration session starts — stopping sensors here would silently
    // kill that trip's confirmation. Same two-flag check as handleDriveDetected.
    if (!this.isTripActive && !this.isValidating) this.sensorManager.stop();
  }

  /** Shares the last completed recording via the OS share sheet. See RawSampleRecorder.exportAsync for the failure shape. */
  public async exportRawRecording(): Promise<string | RawExportFailure> {
    return this.rawRecorder.exportAsync();
  }

  /** Completed recordings on disk, newest first — including sessions from earlier app runs. */
  public listRawRecordings(): string[] {
    return this.rawRecorder.listRecordings();
  }
}


export * from './types';
// Emitted by onInteractionData — part of the public surface, so it is re-exported here
// rather than leaving hosts to reach into sensors/.
export type { InteractionData } from '@/lib/driving-sdk/sensors/PhoneUsageManager';

// Consumed by host apps today through deep paths, which break the moment this package
// gains an `exports` map (CAR-334). The entry point is the only supported import path.
export { isBackgroundThrottlingRiskPlatform, openAppSystemSettings } from './PowerManagement';
export { checkDeviceCapabilities } from './DeviceCapabilities';
export type { DeviceCapabilities } from './DeviceCapabilities';
// Two documents point a consumer at this as the reference for overriding
// SDKConfig.motionThresholds, so it has to be reachable from the package root.
export { DEFAULT_MOTION_THRESHOLDS } from './sensors/SensorManager';
