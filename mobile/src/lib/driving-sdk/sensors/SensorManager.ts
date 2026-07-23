/**
 * @fileoverview GPS + accelerometer + gyroscope listeners for driving event detection — SensorManager
 * @module lib/driving-sdk/sensors/SensorManager
 *
 * @description
 * Detects EVT_BRAKE / EVT_ACCEL / EVT_TURN using a lightweight GPS+IMU fusion that
 * is **independent of how the phone is oriented in the car** (vent mount, pocket,
 * cup holder all work):
 *
 * - **Trigger + direction (orientation-free):** GPS.
 *   - Longitudinal accel = Δspeed / Δt  → brake (deceleration) / accel.
 *   - Lateral accel      = speed × heading-rate → sharp turn.
 * - **Severity + cross-confirm (orientation-free):** accelerometer.
 *   - We remove gravity (EMA) and take the magnitude of the *horizontal* component.
 *     That magnitude is invariant to rotation about the vertical axis, so it does
 *     not depend on the phone's yaw — no per-axis assumption.
 *   - The IMU peak refines the GPS-averaged severity and rejects GPS glitches
 *     (an event fires only if the IMU also saw a real horizontal force).
 *
 * Why not per-axis IMU? An earlier version read brake from accel-Y and turns from
 * accel-X (spec §א Table 1: 0.459g / 0.408g / 0.357g, later recalibrated to
 * 0.53g / 0.48g / 0.43g). That only works if the phone lies flat with +Y pointing
 * forward — false in any real car mount, so real events went undetected regardless
 * of the threshold. GPS dynamics + IMU magnitude are both orientation-invariant,
 * which is why the thresholds below are in a different unit/domain (GPS-measured
 * m/s², a cleaner signal than raw phone accelerometer) and are not directly
 * comparable to those g-values.
 *
 * - Gyroscope (raw z): fraud-detection telemetry only.
 *
 * @remarks No server calls — local logic only. Fires callbacks to DrivingSDK.
 */
import * as Location from 'expo-location';
import { Accelerometer, Gyroscope } from 'expo-sensors';
import { DrivingEventType, DrivingEvent, MotionThresholds } from '@/lib/driving-sdk/types';
// Importing this registers the background-location TaskManager task at module load.
import { DRIVING_SDK_LOCATION_TASK, setLocationHandler } from '@/lib/driving-sdk/sensors/locationTask';

// ─── EMA for gravity isolation ────────────────────────────────────────────────
// Slow-moving component tracks static gravity so phone tilt isn't read as a force.
// Used to split the accelerometer signal into vertical (along gravity) and horizontal.
const LPF_ALPHA = 0.9;

// ─── Detection thresholds (m/s²) ──────────────────────────────────────────────
// Aligned with industry telematics (Geotab/Verizon/Digital Matter): a "hard" event
// is ~0.27–0.4 g sustained. Out-of-the-box default for any consumer of the SDK —
// pass MotionThresholds to the constructor (or SDKConfig.motionThresholds via
// DrivingSDK) to tune sensitivity for a different vehicle type or use case
// without editing this file.
export const DEFAULT_MOTION_THRESHOLDS: MotionThresholds = {
  brakeThresholdMs2: 2.7, // deceleration ≳ 0.27 g (~6 mph/s)
  accelThresholdMs2: 3.0, // acceleration ≳ 0.31 g
  turnThresholdMs2:  3.5, // lateral accel ≳ 0.36 g
};

// Maps (value − threshold) → severity 0..1 over this span.
const SEVERITY_RANGE_MS2 = 5.0;

// Evaluate GPS-derived dynamics over a window of at least this long, so a burst of
// high-frequency location updates (distanceInterval) doesn't turn Doppler-speed
// jitter into phantom events. ~1.5–2 s also matches how long a real maneuver lasts.
const MOTION_EVAL_MIN_S = 1.5;

// Below this speed GPS heading is unreliable — skip turn detection.
const TURN_MIN_SPEED_MS = 2.8; // ~10 km/h

// Lenient IMU cross-confirm: a GPS-detected event fires only if the accelerometer
// also saw at least this much horizontal force during the window. Kept low so real
// events (possibly damped by a soft mount) still pass; it only rejects pure GPS
// glitches where the phone felt essentially no force. Skipped if no accelerometer.
const IMU_CONFIRM_MS2 = 1.0;

// EVT_SWERVE — disabled (not yet supported in UI/scoring; re-enable when ready)
// /** EVT_SWERVE — GPS Heading change rate
//  *  Spec: > 15 °/s sustained for ≥ 3 s
//  *  Recommended for less sensitivity: 20 °/s (eliminates gradual curve noise)
//  */
// const SWERVE_HEADING_RATE_DEG_S = 15;
// const SWERVE_MIN_DURATION_MS    = 3000;
// const SWERVE_SEVERITY_RANGE     = 25;   // 15°/s → 0.0 ; 40°/s → 1.0

export class SensorManager {
  private accelSub: any = null;
  private gyroSub: any = null;
  private lastLocation: any = null;
  private isRunning = false;
  private accelAvailable = false;
  private thresholds: MotionThresholds;

  // EMA gravity state — initialised to [0, 0, 1] (phone face-up assumption)
  private gravity = { x: 0, y: 0, z: 1 };

  // Latest raw sensor values — bundled into onUpdate at GPS rate for fraud detection
  private latestAccelX = 0; // gravity-removed lateral component (g) — fraud telemetry
  private latestGyroZ  = 0; // yaw rate (rad/s) — fraud telemetry only

  // GPS-window state for brake/accel/turn detection
  private motionPrevMs = 0;
  private motionPrevSpeedMs = 0;
  private motionPrevHeadingDeg: number | null = null;
  // Peak orientation-invariant horizontal acceleration (m/s²) seen since the last
  // motion evaluation — the IMU's contribution to severity and cross-confirmation.
  private peakHorizAccelMs2 = 0;

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
    }) => void,
    thresholds?: Partial<MotionThresholds>,
  ) {
    this.onEvent = onEvent;
    this.onUpdate = onUpdate;
    this.thresholds = { ...DEFAULT_MOTION_THRESHOLDS, ...thresholds };
  }

  public async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.gravity = { x: 0, y: 0, z: 1 };
    this.latestAccelX = 0;
    this.latestGyroZ  = 0;
    this.motionPrevMs = 0;
    this.motionPrevSpeedMs = 0;
    this.motionPrevHeadingDeg = null;
    this.peakHorizAccelMs2 = 0;
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
          .hasStartedLocationUpdatesAsync(DRIVING_SDK_LOCATION_TASK)
          .catch(() => false);
        if (alreadyStarted) {
          await Location.stopLocationUpdatesAsync(DRIVING_SDK_LOCATION_TASK).catch(() => {});
        }
        await Location.startLocationUpdatesAsync(DRIVING_SDK_LOCATION_TASK, {
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

      this.accelAvailable = await Accelerometer.isAvailableAsync();
      if (this.accelAvailable) {
        Accelerometer.setUpdateInterval(100); // 10 Hz
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
      Location.hasStartedLocationUpdatesAsync(DRIVING_SDK_LOCATION_TASK)
        .then((started) => { if (started) return Location.stopLocationUpdatesAsync(DRIVING_SDK_LOCATION_TASK); })
        .catch(() => {});
      if (this.accelSub) this.accelSub.remove();
      if (this.gyroSub)  this.gyroSub.remove();
    } catch (err) {
      console.warn('[SensorManager] Error stopping sensors:', err);
    }
    this.lastLocation = null;
  }

  // ─── GPS handler — distance, speed, and brake/accel/turn detection ───────────

  private handleLocation(loc: Location.LocationObject) {
    let distance = 0;
    // Elapsed seconds since the previous GPS tick — used by the SDK's teleportation
    // guard to cap the distance contribution of each update (D-SDK-3).
    let timeDeltaS = 2; // nominal 2 s (matches startLocationUpdatesAsync timeInterval)
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
    // Fire events after onUpdate so the SDK's speed/location is current when stamped.
    this.detectMotionEvents(loc);
  }

  /**
   * GPS-triggered brake / accel / turn detection, cross-confirmed by the IMU.
   * Evaluated over a stable ≥ MOTION_EVAL_MIN_S window to avoid Doppler-jitter noise.
   */
  private detectMotionEvents(loc: Location.LocationObject) {
    const now       = loc.timestamp;
    const speedMs   = Math.max(0, loc.coords.speed ?? 0);
    const headingDeg = loc.coords.heading ?? -1; // expo returns -1 when unavailable

    // First fix in this trip — just seed the window.
    if (this.motionPrevMs === 0) {
      this.motionPrevMs = now;
      this.motionPrevSpeedMs = speedMs;
      this.motionPrevHeadingDeg = headingDeg >= 0 ? headingDeg : null;
      this.peakHorizAccelMs2 = 0;
      return;
    }

    const dt = (now - this.motionPrevMs) / 1000;
    if (dt < MOTION_EVAL_MIN_S) return; // accumulate until the window is wide enough

    const imuPeak = this.peakHorizAccelMs2;
    // Lenient sanity check: reject GPS-only spikes the phone never physically felt.
    const imuConfirms = !this.accelAvailable || imuPeak >= IMU_CONFIRM_MS2;

    // ── Longitudinal: brake (decel) / accel — orientation-free via GPS speed ──
    const aLong = (speedMs - this.motionPrevSpeedMs) / dt; // m/s² (+accel, −brake)
    if (aLong <= -this.thresholds.brakeThresholdMs2 && imuConfirms) {
      const mag = Math.max(-aLong, imuPeak); // IMU peak refines GPS-averaged severity
      this.onEvent({ type: DrivingEventType.HARD_BRAKE, timestamp: new Date(), severity: this.severity(mag, this.thresholds.brakeThresholdMs2) });
    } else if (aLong >= this.thresholds.accelThresholdMs2 && imuConfirms) {
      const mag = Math.max(aLong, imuPeak);
      this.onEvent({ type: DrivingEventType.AGGRESSIVE_ACCEL, timestamp: new Date(), severity: this.severity(mag, this.thresholds.accelThresholdMs2) });
    }

    // ── Lateral: sharp turn — orientation-free via GPS heading rate × speed ──
    if (this.motionPrevHeadingDeg !== null && headingDeg >= 0 && speedMs > TURN_MIN_SPEED_MS) {
      let dHead = headingDeg - this.motionPrevHeadingDeg;
      dHead = ((dHead + 540) % 360) - 180;                       // normalise to [-180,180]
      const yawRate = (Math.abs(dHead) * Math.PI / 180) / dt;    // rad/s
      const aLat = speedMs * yawRate;                            // m/s²
      if (aLat >= this.thresholds.turnThresholdMs2 && imuConfirms) {
        const mag = Math.max(aLat, imuPeak);
        this.onEvent({ type: DrivingEventType.SHARP_TURN, timestamp: new Date(), severity: this.severity(mag, this.thresholds.turnThresholdMs2) });
      }
    }

    // Advance the window.
    this.motionPrevMs = now;
    this.motionPrevSpeedMs = speedMs;
    if (headingDeg >= 0) this.motionPrevHeadingDeg = headingDeg;
    this.peakHorizAccelMs2 = 0;
  }

  private severity(magMs2: number, thresholdMs2: number): number {
    return Math.min(1, Math.max(0, (magMs2 - thresholdMs2) / SEVERITY_RANGE_MS2));
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

  // ─── Accelerometer handler — severity + cross-confirm + fraud telemetry ──────

  private handleAccel(data: { x: number; y: number; z: number }) {
    // Step 1: EMA low-pass filter to isolate slow-changing static gravity.
    this.gravity.x = LPF_ALPHA * this.gravity.x + (1 - LPF_ALPHA) * data.x;
    this.gravity.y = LPF_ALPHA * this.gravity.y + (1 - LPF_ALPHA) * data.y;
    this.gravity.z = LPF_ALPHA * this.gravity.z + (1 - LPF_ALPHA) * data.z;

    // Step 2: gravity-removed dynamic acceleration (g units, expo convention).
    const dynX = data.x - this.gravity.x;
    const dynY = data.y - this.gravity.y;
    const dynZ = data.z - this.gravity.z;

    this.latestAccelX = dynX; // expose lateral component for fraud telemetry (unchanged)

    // Step 3: orientation-invariant horizontal magnitude.
    // Project out the component along gravity (vertical); what remains is horizontal,
    // and its magnitude does not depend on the phone's yaw — so brake/accel/turn
    // forces are captured regardless of how the phone is mounted.
    const gMag = Math.sqrt(this.gravity.x ** 2 + this.gravity.y ** 2 + this.gravity.z ** 2) || 1;
    const vertComp = (dynX * this.gravity.x + dynY * this.gravity.y + dynZ * this.gravity.z) / gMag;
    const dynMagSq = dynX ** 2 + dynY ** 2 + dynZ ** 2;
    const horizMs2 = Math.sqrt(Math.max(0, dynMagSq - vertComp ** 2)) * 9.81; // g → m/s²

    if (horizMs2 > this.peakHorizAccelMs2) this.peakHorizAccelMs2 = horizMs2;
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
