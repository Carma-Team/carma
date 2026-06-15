/**
 * @fileoverview GPS, accelerometer, and gyroscope listeners for driving event detection — SensorManager
 * @module lib/driving-sdk/sensors/SensorManager
 *
 * @description
 * Implements the detection algorithm from spec §א — Table 1 (Appendix 1).
 * - Accelerometer Y-axis (5-sample MA): EVT_BRAKE, EVT_ACCEL
 * - Accelerometer X-axis (5-sample MA): EVT_TURN
 * - GPS Heading rate:                   EVT_SWERVE
 * - Gyroscope (raw):                    fraud-detection telemetry only
 *
 * @remarks No server calls — local logic only. Fires callbacks to DrivingSDK.
 */
import * as Location from 'expo-location';
import { Accelerometer, Gyroscope } from 'expo-sensors';
import { DrivingEventType, DrivingEvent } from '@/lib/driving-sdk/types';
// Importing this registers the background-location TaskManager task at module load.
import { CARMA_LOCATION_TASK, setLocationHandler } from '@/lib/driving-sdk/sensors/locationTask';

// ─── EMA for gravity isolation ────────────────────────────────────────────────
// Slow-moving component (~0.5 s time constant at 10 Hz) tracks static gravity.
// Not specified in the spec — retained because axis-independent gravity removal
// prevents phone tilt from appearing as a driving event.
const LPF_ALPHA = 0.8;

// ─── Moving-average window (spec §א note 1) ───────────────────────────────────
// IMU values are averaged over 5 consecutive samples before threshold evaluation.
const MA_WINDOW = 5;

// ─── Detection thresholds — SPEC VALUES (spec §א Table 1) ────────────────────
// Convert m/s² → g (1 g = 9.81 m/s²).

/** EVT_BRAKE  — Accelerometer Y-axis (deceleration, positive spike)
 *  Spec: > 4.5 m/s² = 0.459 g
 *  Recommended for less sensitivity (fewer false positives): 0.60 g (≈ 5.9 m/s²)
 */
const BRAKE_THRESHOLD_G  = 4.5 / 9.81;  // 0.459 g

/** EVT_ACCEL  — Accelerometer Y-axis (acceleration, negative spike)
 *  Spec: > 4.0 m/s² = 0.408 g
 *  Recommended for less sensitivity: 0.55 g (≈ 5.4 m/s²)
 */
const ACCEL_THRESHOLD_G  = 4.0 / 9.81;  // 0.408 g

/** EVT_TURN   — Accelerometer X-axis (lateral G, either direction)
 *  Spec: > 3.5 m/s² = 0.357 g
 *  Recommended for less sensitivity: 0.50 g (≈ 4.9 m/s²)
 */
const TURN_THRESHOLD_G   = 3.5 / 9.81;  // 0.357 g

// EVT_SWERVE — disabled (not yet supported in UI/scoring; re-enable when ready)
// /** EVT_SWERVE — GPS Heading change rate
//  *  Spec: > 15 °/s sustained for ≥ 3 s
//  *  Recommended for less sensitivity: 20 °/s (eliminates gradual curve noise)
//  */
// const SWERVE_HEADING_RATE_DEG_S = 15;
// const SWERVE_MIN_DURATION_MS    = 3000;
// const SWERVE_SEVERITY_RANGE     = 25;   // 15°/s → 0.0 ; 40°/s → 1.0

// ─── Severity scale upper bound (normalises severity to [0, 1]) ────────────────
// severity = (value - threshold) / SEVERITY_RANGE, clamped [0, 1]
const SEVERITY_RANGE_G = 1.0;   // e.g. 0.459 g → 0.0 ; 1.459 g → 1.0

export class SensorManager {
  private accelSub: any = null;
  private gyroSub: any = null;
  private lastLocation: any = null;
  private isRunning = false;

  // EMA gravity state — initialised to [0, 0, 1] (phone face-up assumption)
  private gravity = { x: 0, y: 0, z: 1 };

  // 5-sample MA buffers for gravity-removed X and Y components
  private maX: number[] = [];
  private maY: number[] = [];

  // Latest raw sensor values — bundled into onUpdate at GPS rate for fraud detection
  private latestAccelX = 0; // gravity-removed lateral component (g)
  private latestGyroZ  = 0; // yaw rate (rad/s) — fraud telemetry only

  // GPS heading state for EVT_SWERVE (disabled — uncomment when re-enabling)
  // private prevHeading:      number | null = null;
  // private prevLocTimestamp: number | null = null;
  // private swerveStartTime:  number | null = null;

  private onEvent: (event: DrivingEvent) => void;
  private onUpdate: (data: {
    distanceKm: number; currentSpeed: number; timeDeltaS: number;
    accelX: number; gyroZ: number;
    lat?: number; lng?: number;
  }) => void;

  constructor(
    onEvent: (event: DrivingEvent) => void,
    onUpdate: (data: {
      distanceKm: number; currentSpeed: number; timeDeltaS: number;
      accelX: number; gyroZ: number;
      lat?: number; lng?: number;
    }) => void
  ) {
    this.onEvent = onEvent;
    this.onUpdate = onUpdate;
  }

  public async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.gravity = { x: 0, y: 0, z: 1 };
    this.maX = [];
    this.maY = [];
    this.latestAccelX = 0;
    this.latestGyroZ  = 0;
    // this.prevHeading      = null;   // EVT_SWERVE disabled
    // this.prevLocTimestamp = null;
    // this.swerveStartTime  = null;

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        // Best-effort background permission so distance keeps counting when the
        // phone is locked / app is backgrounded. Foreground still works if denied.
        try { await Location.requestBackgroundPermissionsAsync(); } catch { /* ignore */ }

        // Feed every location (foreground AND background, via the TaskManager task)
        // through the same accumulation path. High accuracy = GPS only, avoiding
        // network/cell jumps that inflate distance when stationary (D-SDK-3).
        setLocationHandler((loc) => this.handleLocation(loc));
        const alreadyStarted = await Location
          .hasStartedLocationUpdatesAsync(CARMA_LOCATION_TASK)
          .catch(() => false);
        if (alreadyStarted) {
          await Location.stopLocationUpdatesAsync(CARMA_LOCATION_TASK).catch(() => {});
        }
        await Location.startLocationUpdatesAsync(CARMA_LOCATION_TASK, {
          accuracy: Location.Accuracy.High,
          timeInterval: 2000,
          distanceInterval: 5,
          pausesUpdatesAutomatically: false,
          showsBackgroundLocationIndicator: true,
          foregroundService: {
            notificationTitle: 'Trip in progress',
            notificationBody: 'Tracking your route and distance',
          },
        });
      } else {
        console.warn('[SensorManager] Location permission denied');
      }

      const accelAvailable = await Accelerometer.isAvailableAsync();
      if (accelAvailable) {
        Accelerometer.setUpdateInterval(100); // 10 Hz — gives 5-sample MA a 0.5 s window
        this.accelSub = Accelerometer.addListener(data => this.handleAccel(data));
      }

      const gyroAvailable = await Gyroscope.isAvailableAsync();
      if (gyroAvailable) {
        Gyroscope.setUpdateInterval(100);
        this.gyroSub = Gyroscope.addListener(data => { this.latestGyroZ = data.z; });
      }
    } catch (err) {
      console.error('[SensorManager] Error starting sensors:', err);
    }
  }

  public stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    try {
      setLocationHandler(null);
      Location.hasStartedLocationUpdatesAsync(CARMA_LOCATION_TASK)
        .then((started) => { if (started) return Location.stopLocationUpdatesAsync(CARMA_LOCATION_TASK); })
        .catch(() => {});
      if (this.accelSub) this.accelSub.remove();
      if (this.gyroSub)  this.gyroSub.remove();
    } catch (err) {
      console.warn('[SensorManager] Error stopping sensors:', err);
    }
    this.lastLocation = null;
  }

  // ─── GPS handler — distance and speed ───────────────────────────────────────

  private handleLocation(loc: Location.LocationObject) {
    let distance = 0;
    // Elapsed seconds since the previous GPS tick — used by the SDK's teleportation
    // guard to cap the distance contribution of each update (D-SDK-3).
    let timeDeltaS = 2; // nominal 2 s (matches watchPositionAsync timeInterval)
    if (this.lastLocation) {
      distance = this.calculateDistance(
        this.lastLocation.coords.latitude,
        this.lastLocation.coords.longitude,
        loc.coords.latitude,
        loc.coords.longitude
      );
      timeDeltaS = Math.max(0.5, (loc.timestamp - this.lastLocation.timestamp) / 1000);
      // this.detectSwerve(loc);  // EVT_SWERVE disabled — uncomment to re-enable
    }
    this.lastLocation = loc;
    this.onUpdate({
      distanceKm:   distance,
      currentSpeed: Math.max(0, loc.coords.speed ?? 0) * 3.6,
      timeDeltaS,
      accelX:       this.latestAccelX,
      gyroZ:        this.latestGyroZ,
      lat:          loc.coords.latitude,
      lng:          loc.coords.longitude,
    });
  }

  // EVT_SWERVE detection — disabled (not yet in UI/scoring; re-enable when ready)
  // private detectSwerve(loc: Location.LocationObject) {
  //   const now = loc.timestamp;
  //   const currentHeading = this.computeBearing(
  //     this.lastLocation.coords.latitude, this.lastLocation.coords.longitude,
  //     loc.coords.latitude, loc.coords.longitude
  //   );
  //   if (this.prevHeading !== null && this.prevLocTimestamp !== null) {
  //     const timeDeltaS = (now - this.prevLocTimestamp) / 1000;
  //     if (timeDeltaS > 0) {
  //       let delta = currentHeading - this.prevHeading;
  //       delta = ((delta + 540) % 360) - 180;
  //       const headingRate = Math.abs(delta) / timeDeltaS;
  //       if (headingRate > SWERVE_HEADING_RATE_DEG_S) {
  //         if (this.swerveStartTime === null) {
  //           this.swerveStartTime = now;
  //         } else if (now - this.swerveStartTime >= SWERVE_MIN_DURATION_MS) {
  //           const severity = Math.min(1, Math.max(0,
  //             (headingRate - SWERVE_HEADING_RATE_DEG_S) / SWERVE_SEVERITY_RANGE
  //           ));
  //           this.onEvent({ type: DrivingEventType.SWERVE, timestamp: new Date(), severity });
  //           this.swerveStartTime = null;
  //         }
  //       } else {
  //         this.swerveStartTime = null;
  //       }
  //     }
  //   }
  //   this.prevHeading      = currentHeading;
  //   this.prevLocTimestamp = now;
  // }

  // ─── Accelerometer handler — EVT_BRAKE, EVT_ACCEL, EVT_TURN ─────────────────

  private handleAccel(data: { x: number; y: number; z: number }) {
    // Step 1: EMA low-pass filter to isolate slow-changing static gravity
    this.gravity.x = LPF_ALPHA * this.gravity.x + (1 - LPF_ALPHA) * data.x;
    this.gravity.y = LPF_ALPHA * this.gravity.y + (1 - LPF_ALPHA) * data.y;
    this.gravity.z = LPF_ALPHA * this.gravity.z + (1 - LPF_ALPHA) * data.z;

    // Step 2: gravity-removed dynamic components
    const dynX = data.x - this.gravity.x;  // lateral force
    const dynY = data.y - this.gravity.y;  // longitudinal force

    this.latestAccelX = dynX; // expose for fraud telemetry

    // Step 3: 5-sample Moving Average (spec §א note 1)
    this.maX.push(dynX);
    this.maY.push(dynY);
    if (this.maX.length > MA_WINDOW) this.maX.shift();
    if (this.maY.length > MA_WINDOW) this.maY.shift();

    if (this.maX.length < MA_WINDOW) return; // wait until buffer is full

    const smoothX = this.maX.reduce((s, v) => s + v, 0) / MA_WINDOW;
    const smoothY = this.maY.reduce((s, v) => s + v, 0) / MA_WINDOW;

    // ── EVT_BRAKE (spec: Accel Y > +4.5 m/s² = +0.459 g) ────────────────────
    if (smoothY > BRAKE_THRESHOLD_G) {
      const severity = Math.min(1, Math.max(0, (smoothY - BRAKE_THRESHOLD_G) / SEVERITY_RANGE_G));
      this.onEvent({ type: DrivingEventType.HARD_BRAKE, timestamp: new Date(), severity });
      return; // brake dominates; don't also fire accel/turn in the same sample
    }

    // ── EVT_ACCEL (spec: Accel Y < -4.0 m/s² = -0.408 g) ────────────────────
    if (smoothY < -ACCEL_THRESHOLD_G) {
      const severity = Math.min(1, Math.max(0, (-smoothY - ACCEL_THRESHOLD_G) / SEVERITY_RANGE_G));
      this.onEvent({ type: DrivingEventType.AGGRESSIVE_ACCEL, timestamp: new Date(), severity });
      return;
    }

    // ── EVT_TURN (spec: |Accel X| > 3.5 m/s² = 0.357 g) ────────────────────
    if (Math.abs(smoothX) > TURN_THRESHOLD_G) {
      const severity = Math.min(1, Math.max(0, (Math.abs(smoothX) - TURN_THRESHOLD_G) / SEVERITY_RANGE_G));
      this.onEvent({ type: DrivingEventType.SHARP_TURN, timestamp: new Date(), severity });
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  /** Compass bearing from point 1 to point 2, in degrees [0, 360). */
  private computeBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const lat1r = lat1 * Math.PI / 180;
    const lat2r = lat2 * Math.PI / 180;
    const y = Math.sin(dLon) * Math.cos(lat2r);
    const x = Math.cos(lat1r) * Math.sin(lat2r) - Math.sin(lat1r) * Math.cos(lat2r) * Math.cos(dLon);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }
}
