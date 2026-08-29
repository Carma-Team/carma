/**
 * @file SensorManager.ts
 * @owner May Hajbi — driving-sdk maintainer
 * @brief Detects hard braking, aggressive acceleration and sharp turns from a GPS+IMU fusion
 * that does not depend on how the phone is oriented in the vehicle.
 * Also resolves the IMU into the vehicle's own frame and streams speed, distance and
 * those vehicle-frame values to the SDK on every fix.
 *
 * @description
 * Detects EVT_BRAKE / EVT_ACCEL / EVT_TURN using a lightweight GPS+IMU fusion that
 * is **independent of how the phone is oriented in the car** (vent mount, pocket,
 * cup holder all work):
 *
 * - **Trigger + direction (orientation-free):** GPS.
 *   - Longitudinal accel = Δspeed / Δt  → brake (deceleration) / accel.
 *   - Lateral accel      = speed × heading-rate → sharp turn.
 * - **Cross-confirm (orientation-free):** accelerometer.
 *   - We remove gravity (EMA) and take the magnitude of the *horizontal* component.
 *     That magnitude is invariant to rotation about the vertical axis, so it does
 *     not depend on the phone's yaw — no per-axis assumption.
 *   - An event fires only if the IMU also saw a real horizontal force, rejecting
 *     pure GPS glitches. This magnitude is not a vehicle-frame axis, so it is not
 *     reported as event severity (scoring.md §3.4) — only used as a gate.
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
 * **Vehicle frame.** Both IMU streams are resolved out of the phone's own axes before
 * they leave this class: horizontal force into signed longitudinal and lateral, and
 * angular rate about gravity rather than about the device's Z axis. The geometry lives in
 * `vehicleFrame.ts`; the forward direction is learned from agreement between GPS speed
 * changes and the force felt over them, and is relearned when the phone moves. Where the
 * frame cannot be resolved the value is `null`, never 0 (docs/fraud-detection.md §3.2).
 *
 * - The full 10 Hz accelerometer and gyroscope streams are also offered raw to optional
 *   `onAccelSample`/`onGyroSample` consumers, so nothing else has to subscribe to a
 *   sensor this class already keeps powered.
 *
 * @remarks No server calls — local logic only. Fires callbacks to DrivingSDK.
 */
import * as Location from 'expo-location';
import { Accelerometer, Gyroscope } from 'expo-sensors';
import { DrivingEventType, DrivingEvent, MotionThresholds, SensorUpdate } from '@/lib/driving-sdk/types';
// Importing this registers the background-location TaskManager task at module load.
import { DRIVING_SDK_LOCATION_TASK, setLocationHandler } from '@/lib/driving-sdk/sensors/locationTask';
import {
  Horizontal2D, HorizontalBasis, VehicleFrameEstimator, horizontalBasis,
  projectHorizontal, yawRateAboutGravity,
} from '@/lib/driving-sdk/sensors/vehicleFrame';

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

// Below this gap, two consecutive GPS fixes are treated as the same physical tick
// rather than independent samples — cloud data (#17) found devices emitting
// near-duplicate fixes <0.5s apart, which imply physically impossible
// accelerations if processed as real samples. The server already dedups on
// its side; this stops the duplicate from ever reaching distance/motion math
// on the client too. Forward gaps only — see handleLocation for why a backwards
// one is a different animal.
const MIN_TICK_INTERVAL_MS = 500;

// If no valid GPS speed reading arrives for this long, stop reporting the last known
// value for currentSpeed and fall back to 0 instead. Without this, a sustained
// speed-unavailable stretch (weak fix, urban canyon, parking garage) pins currentSpeed
// above whatever "stopped" threshold the host's validator uses forever, and a trip that
// should end after a sustained stop never does. Momentary dropouts (a few seconds)
// still carry the last reading through; only a sustained one decays.
const STALE_SPEED_MS = 10000;

// That decay is time-based, but it used to be evaluated only inside handleLocation —
// so it ran only when a fix arrived, driven by the very stream whose silence it exists
// to cover. iOS delivers nothing at all while the vehicle is stationary (it ignores
// timeInterval and paces purely off distanceInterval), and Android can defer fixes well
// past STALE_SPEED_MS under Doze / OEM power management (#17). This timer separates
// "needs a new fix" from "needs a tick": it re-evaluates the decay against wall clock
// and reports the result, leaving the distance filter and its jitter mitigation alone.
//
// It emits only once the held speed has decayed to 0, and that is load-bearing.
// Reporting the held value instead would be worse than staying silent: index.ts gates
// distance and waypoint collection on speed >= 3 km/h, and appends waypoints from the
// *last known* location rather than the update's own coordinates — so a tick carrying
// a live held speed would inject a stationary point into the GPS trace the server
// scores against. At 0 the gate blocks every one of those paths.
const SPEED_TICK_INTERVAL_MS = 2000;

const MS2_PER_G = 9.81;

// docs/fraud-detection.md §3.1: a sensor is available only while a subscription is
// actively delivering samples, not merely because isAvailableAsync() once said yes.
// A dead listener (OS killed it, hardware faulted mid-trip) must read as unavailable,
// not as a frozen last value — that's the exact shape CAR-162 is built to distrust.
const SENSOR_STALE_MS = 5000;

// SWERVE is in the event enum but nothing here detects it. The detector that was
// written for it was never verified on a drive and is not scheduled — it lives in
// docs/disabled-swerve-detection.md, with what restoring it would take.

export class SensorManager {
  private accelSub: any = null;
  private gyroSub: any = null;
  private lastLocation: any = null;
  private lastValidSpeedMs = 0; // carries forward across expo's -1 "unavailable" ticks
  private lastValidSpeedAtMs = 0; // GPS fix timestamp lastValidSpeedMs was captured at — decays it back to 0 if stale (STALE_SPEED_MS)
  private speedTicker: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private accelAvailable = false;
  private gyroAvailable = false;
  // Wall-clock timestamp of the last delivered sample per sensor — SENSOR_STALE_MS
  // turns "was available at start()" into "is available right now" (§3.1).
  private lastAccelSampleAtMs = 0;
  private lastGyroSampleAtMs = 0;
  private backgroundLocationAvailable = false;
  // True only when the accelerometer registration itself threw — distinct from
  // accelAvailable=false meaning "no such hardware". imuConfirms below must fail
  // open for the latter (GPS-only detection is the intended fallback) and fail
  // closed for this one (a broken subscription must not read as confirmed by design).
  private accelInitFailed = false;
  private thresholds: MotionThresholds;

  // EMA gravity state — initialised to [0, 0, 1] (phone face-up assumption)
  private gravity = { x: 0, y: 0, z: 1 };

  // Latest vehicle-frame readings — bundled into onUpdate at GPS rate. Every one of
  // these is null until the frame resolves, never 0: a frame that cannot be resolved
  // is an absence of measurement, and a 0 here would read as "no force" (§3.1/§3.2).
  private latestHoriz2d: Horizontal2D | null = null;
  private latestYawRateRadS: number | null = null;
  // Resolves phone-frame horizontal force into the vehicle's longitudinal/lateral axes.
  // Learns forward from ordinary driving; restarts itself when the phone moves.
  private vehicleFrame = new VehicleFrameEstimator();
  private latestBasis: HorizontalBasis | null = null;
  // Horizontal force summed over the current GPS window, and its sample count. Their
  // mean is one observation for the forward estimate, paired with the window's own
  // GPS-measured longitudinal acceleration.
  private windowHorizSum: Horizontal2D = { a: 0, b: 0 };
  private windowHorizCount = 0;

  // GPS-window state for brake/accel/turn detection
  private motionPrevMs = 0;
  private motionPrevSpeedMs = 0;
  private motionPrevHeadingDeg: number | null = null;
  // Peak orientation-invariant horizontal acceleration (m/s²) seen since the last
  // motion evaluation — the IMU's contribution to cross-confirmation (CAR-156: no
  // longer reported as severity, the magnitude isn't a vehicle-frame axis).
  private peakHorizAccelMs2 = 0;
  // The peak's own horizontal vector, kept unresolved. Resolving it at emission time
  // rather than when it was sampled lets the window that *taught* the estimator its
  // forward direction be the first window to report vehicle-frame values.
  private peakHoriz2d: Horizontal2D | null = null;
  private aboveConfirmSinceMs: number | null = null;
  // Start of the streak that produced peakHorizAccelMs2, not just whichever
  // streak happens to run longest — a rough road can out-last the actual brake.
  private peakStreakStartMs: number | null = null;
  // Duration (ms) of that streak — reported as DrivingEvent.durationMs.
  private peakDurationMs = 0;

  private onEvent: (event: DrivingEvent) => void;
  // Raw 10 Hz gyroscope tap. Exists so a second consumer can read rotation without
  // opening its own Gyroscope subscription — the sensor is already powered here, and
  // the onUpdate bundle below only carries gyroZ at GPS rate (~2 s), far too coarse
  // for anything sampling motion.
  private onGyroSample?: (sample: { x: number; y: number; z: number }) => void;
  // Raw 10 Hz accelerometer tap, symmetric to onGyroSample — same reasoning: this
  // class already owns the subscription, so a second consumer (RawSampleRecorder)
  // taps it instead of opening its own.
  private onAccelSample?: (sample: { x: number; y: number; z: number }) => void;
  private onUpdate: (data: SensorUpdate) => void;

  constructor(
    onEvent: (event: DrivingEvent) => void,
    onUpdate: (data: SensorUpdate) => void,
    thresholds?: Partial<MotionThresholds>,
    onGyroSample?: (sample: { x: number; y: number; z: number }) => void,
    onAccelSample?: (sample: { x: number; y: number; z: number }) => void,
  ) {
    this.onEvent = onEvent;
    this.onUpdate = onUpdate;
    this.thresholds = { ...DEFAULT_MOTION_THRESHOLDS, ...thresholds };
    this.onGyroSample = onGyroSample;
    this.onAccelSample = onAccelSample;
  }

  public async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.gravity = { x: 0, y: 0, z: 1 };
    this.lastValidSpeedMs = 0;
    this.lastValidSpeedAtMs = 0;
    this.latestHoriz2d = null;
    this.latestYawRateRadS = null;
    this.latestBasis = null;
    this.vehicleFrame.reset();
    this.windowHorizSum = { a: 0, b: 0 };
    this.windowHorizCount = 0;
    this.accelAvailable = false;
    this.gyroAvailable  = false;
    this.lastAccelSampleAtMs = 0;
    this.lastGyroSampleAtMs  = 0;
    this.backgroundLocationAvailable = false;
    this.motionPrevMs = 0;
    this.motionPrevSpeedMs = 0;
    this.motionPrevHeadingDeg = null;
    this.peakHorizAccelMs2 = 0;
    this.peakHoriz2d = null;
    this.aboveConfirmSinceMs = null;
    this.peakStreakStartMs = null;
    this.peakDurationMs = 0;
    this.accelInitFailed = false;

    // Deliberately outside the try below: the tick is what keeps speed honest when the
    // location stream is unavailable, which includes the case where starting it failed.
    this.speedTicker = setInterval(() => this.handleSpeedTick(), SPEED_TICK_INTERVAL_MS);

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        // Best-effort background permission so distance keeps counting when the
        // phone is locked / app is backgrounded. Foreground still works if denied —
        // but the outcome is recorded either way (CAR-16), instead of the previous
        // swallowed catch that left no trace of a denial.
        try {
          const bg = await Location.requestBackgroundPermissionsAsync();
          this.backgroundLocationAvailable = bg.status === 'granted';
        } catch {
          this.backgroundLocationAvailable = false;
        }

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
        // #17: cloud data shows some devices deliver these ticks at a ~6s median
        // with >15s gaps instead of the requested 2s — timeInterval/distanceInterval
        // are hints, not guarantees; Android's FusedLocationProviderClient can defer
        // updates under battery-saver/Doze or aggressive OEM power management, and a
        // foreground service raises priority but doesn't fully override it.
        // Tried raising accuracy to BestForNavigation to push cadence further, but on
        // Android expo-location's mapAccuracyToPriority maps both High and
        // BestForNavigation to the same PRIORITY_HIGH_ACCURACY, and the caller-supplied
        // timeInterval/distanceInterval still override the accuracy-derived defaults —
        // so it's a no-op there and only costs battery on iOS, where it is a distinct,
        // higher-power tier. Staying on High; #17 remains open, not fixed by this tier.
        await Location.startLocationUpdatesAsync(DRIVING_SDK_LOCATION_TASK, {
          accuracy: Location.Accuracy.High,
          timeInterval: 2000,
          distanceInterval: 5,
          // iOS-only — Android ignores it. Without it CoreLocation assumes
          // CLActivityTypeOther and tunes GPS for an unknown activity.
          activityType: Location.ActivityType.AutomotiveNavigation,
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
    } catch (err) {
      console.error('[SensorManager] Error starting location:', err);
    }

    // Deliberately its own try: a location failure above must not skip IMU
    // registration, and a gyroscope failure below must not misattribute itself
    // to the accelerometer via a shared catch — each sensor fails independently.
    try {
      this.accelAvailable = await Accelerometer.isAvailableAsync();
      if (this.accelAvailable) {
        Accelerometer.setUpdateInterval(100); // 10 Hz
        // Grace period: a sensor subscribed a moment ago isn't stale yet even
        // though no sample has landed. The first real sample overwrites this.
        this.lastAccelSampleAtMs = Date.now();
        this.accelSub = Accelerometer.addListener(data => this.handleAccel(data));
      }
    } catch (err) {
      console.error('[SensorManager] Error starting accelerometer:', err);
      this.accelAvailable = false;
      this.accelInitFailed = true;
    }

    try {
      this.gyroAvailable = await Gyroscope.isAvailableAsync();
      if (this.gyroAvailable) {
        Gyroscope.setUpdateInterval(100);
        this.lastGyroSampleAtMs = Date.now(); // grace period, see accel above
        this.gyroSub = Gyroscope.addListener(data => {
          // Yaw is rotation about gravity, not about the device's Z axis — those agree
          // only for a phone lying perfectly flat, which is the assumption CAR-167 was
          // filed against. Null while gravity has not converged.
          this.latestYawRateRadS = yawRateAboutGravity(data, this.gravity);
          this.lastGyroSampleAtMs = Date.now();
          this.onGyroSample?.(data);
        });
      }
    } catch (err) {
      console.error('[SensorManager] Error starting gyroscope:', err);
    }
  }

  public stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.speedTicker) {
      clearInterval(this.speedTicker);
      this.speedTicker = null;
    }
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
    // Drop near-duplicate fixes at the source (#17) — some devices emit bursts of
    // GPS ticks <0.5s apart under certain background/throttling conditions. Treating
    // these as independent samples would understate timeDeltaS and can imply
    // impossible accelerations; simplest and safest is to ignore the repeat entirely.
    //
    // A backwards gap is a clock step (NTP correction, manual time change), not a
    // repeat, and dropping it costs the rest of the trip rather than one fix:
    // lastLocation keeps the pre-step stamp, so every fix after it reads as a
    // duplicate until wall clock catches up, and detectMotionEvents stalls on that
    // same stamp. Nothing measured across the step means anything, so re-anchor.
    if (this.lastLocation) {
      const gapMs = loc.timestamp - this.lastLocation.timestamp;
      if (gapMs < 0) {
        this.lastLocation = null; // distance 0 and the nominal timeDeltaS below
        this.motionPrevMs = 0;    // re-seeds the detection window on the next fix
        // Every anchor stamped on the old clock has to move, this one included: left
        // in the future, STALE_SPEED_MS never elapses, so a held speed never decays to
        // 0 and handleSpeedTick — which only emits at 0 — goes silent for the length
        // of the step. A stop after the step would then never be reported as one.
        this.lastValidSpeedAtMs = loc.timestamp;
      } else if (gapMs < MIN_TICK_INTERVAL_MS) {
        return;
      }
    }

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
    }
    // expo returns -1 (not 0) for "speed unavailable" — e.g. a momentary loss of
    // speed lock at highway speed. Clamping that to 0 reads as a real deceleration
    // to zero, so hold the last known-good speed instead of reporting a phantom 0.
    const rawSpeed = loc.coords.speed;
    if (rawSpeed !== null && rawSpeed >= 0) {
      this.lastValidSpeedMs = rawSpeed;
      this.lastValidSpeedAtMs = loc.timestamp;
    }
    const effectiveSpeedMs = this.decayedSpeedMs(loc.timestamp);

    this.lastLocation = loc;
    this.onUpdate({
      distanceKm:   distance,
      currentSpeed: effectiveSpeedMs * 3.6,
      timeDeltaS,
      longitudinalAccelG: this.vehicleFrameForce()?.longitudinal ?? null,
      lateralAccelG:      this.vehicleFrameForce()?.lateral ?? null,
      yawRateRadS:        this.latestYawRateRadS,
      accelAvailable: this.accelAvailable && this.isSensorFresh(this.lastAccelSampleAtMs),
      gyroAvailable:  this.gyroAvailable && this.isSensorFresh(this.lastGyroSampleAtMs),
      accelInitFailed: this.accelInitFailed,
      backgroundLocationAvailable: this.backgroundLocationAvailable,
      lat:          loc.coords.latitude,
      lng:          loc.coords.longitude,
      accuracy:     loc.coords.accuracy ?? undefined,
      fixTs:        loc.timestamp,
    });
    // Fire events after onUpdate so the SDK's speed/location is current when stamped.
    this.detectMotionEvents(loc, rawSpeed !== null && rawSpeed >= 0 ? rawSpeed : null);
  }

  /**
   * Last known-good speed (m/s), decayed to 0 once it has been stale for
   * STALE_SPEED_MS. `atMs` is the instant to measure staleness against: a GPS fix
   * timestamp on the fix path, wall clock on the tick path. Both are epoch ms —
   * expo-location exports the native timestamp as `timeIntervalSince1970 * 1000`.
   */
  private decayedSpeedMs(atMs: number): number {
    return (atMs - this.lastValidSpeedAtMs) < STALE_SPEED_MS ? this.lastValidSpeedMs : 0;
  }

  // §3.1: available at start() plus a sample within the last SENSOR_STALE_MS —
  // not just "was present when start() ran".
  private isSensorFresh(lastSampleAtMs: number): boolean {
    return (Date.now() - lastSampleAtMs) < SENSOR_STALE_MS;
  }

  /**
   * Speed-only update, emitted when the GPS stream has gone quiet long enough for the
   * held speed to expire. Not routed through handleLocation on purpose: there is no
   * new position, so there is no distance, no waypoint and no motion-event evaluation
   * to do — fabricating any of those from a stale fix is what this must never become.
   */
  private handleSpeedTick() {
    if (this.decayedSpeedMs(Date.now()) !== 0) return;
    this.onUpdate({
      distanceKm:   0,
      currentSpeed: 0,
      timeDeltaS:   SPEED_TICK_INTERVAL_MS / 1000,
      longitudinalAccelG: this.vehicleFrameForce()?.longitudinal ?? null,
      lateralAccelG:      this.vehicleFrameForce()?.lateral ?? null,
      yawRateRadS:        this.latestYawRateRadS,
      accelAvailable: this.accelAvailable && this.isSensorFresh(this.lastAccelSampleAtMs),
      gyroAvailable:  this.gyroAvailable && this.isSensorFresh(this.lastGyroSampleAtMs),
      accelInitFailed: this.accelInitFailed,
      backgroundLocationAvailable: this.backgroundLocationAvailable,
    });
  }

  /**
   * GPS-triggered brake / accel / turn detection, cross-confirmed by the IMU.
   * Evaluated over a stable ≥ MOTION_EVAL_MIN_S window to avoid Doppler-jitter noise.
   */
  private detectMotionEvents(loc: Location.LocationObject, speedMs: number | null) {
    const now       = loc.timestamp;
    const headingDeg = loc.coords.heading ?? -1; // expo returns -1 when unavailable

    // Speed unavailable this tick (expo sentinel, see handleLocation) — skip the
    // window rather than treating it as 0, which would read as a fake hard brake
    // followed by a fake aggressive accel once GPS speed lock recovers.
    if (speedMs === null) return;

    // First fix in this trip — just seed the window.
    if (this.motionPrevMs === 0) {
      this.motionPrevMs = now;
      this.motionPrevSpeedMs = speedMs;
      this.motionPrevHeadingDeg = headingDeg >= 0 ? headingDeg : null;
      this.peakHorizAccelMs2 = 0;
      this.peakHoriz2d = null;
      this.aboveConfirmSinceMs = null;
      this.peakStreakStartMs = null;
      this.peakDurationMs = 0;
      this.windowHorizSum = { a: 0, b: 0 };
      this.windowHorizCount = 0;
      return;
    }

    const dt = (now - this.motionPrevMs) / 1000;
    if (dt < MOTION_EVAL_MIN_S) return; // accumulate until the window is wide enough

    const imuPeak = this.peakHorizAccelMs2;
    const imuPeakDurationMs = this.peakDurationMs;
    // Lenient sanity check: reject GPS-only spikes the phone never physically felt.
    // Fails open only for "no accelerometer hardware" — a broken registration
    // (accelInitFailed) must not read the same way, or a GPS glitch during a
    // subscription failure fires unconfirmed with peakG:0/durationMs:0.
    const imuConfirms = (!this.accelAvailable && !this.accelInitFailed) || imuPeak >= IMU_CONFIRM_MS2;

    // ── Longitudinal: brake (decel) / accel — orientation-free via GPS speed ──
    const aLong = (speedMs - this.motionPrevSpeedMs) / dt; // m/s² (+accel, −brake)

    // Teach the frame before reading it. This window's own speed change is evidence of
    // which way forward points, and folding it in first is what lets the very window
    // that completes the estimate be the first one to report vehicle-frame values.
    if (this.windowHorizCount > 0 && this.latestBasis) {
      this.vehicleFrame.observe(
        { a: this.windowHorizSum.a / this.windowHorizCount, b: this.windowHorizSum.b / this.windowHorizCount },
        aLong,
        this.latestBasis,
      );
    }
    // Null until the frame resolves — §3.2 requires an unresolvable frame to report
    // nothing rather than a number in the phone's own axes.
    const peak = this.peakHoriz2d ? this.vehicleFrame.resolve(this.peakHoriz2d) : null;
    const peakFields = peak
      ? { peakLongitudinalG: peak.longitudinal, peakLateralG: peak.lateral }
      : {};

    if (aLong <= -this.thresholds.brakeThresholdMs2 && imuConfirms) {
      this.onEvent({ type: DrivingEventType.HARD_BRAKE, timestamp: new Date(), durationMs: imuPeakDurationMs, ...peakFields });
    } else if (aLong >= this.thresholds.accelThresholdMs2 && imuConfirms) {
      this.onEvent({ type: DrivingEventType.AGGRESSIVE_ACCEL, timestamp: new Date(), durationMs: imuPeakDurationMs, ...peakFields });
    }

    // ── Lateral: sharp turn — orientation-free via GPS heading rate × speed ──
    if (this.motionPrevHeadingDeg !== null && headingDeg >= 0 && speedMs > TURN_MIN_SPEED_MS) {
      let dHead = headingDeg - this.motionPrevHeadingDeg;
      dHead = ((dHead + 540) % 360) - 180;                       // normalise to [-180,180]
      const yawRate = (Math.abs(dHead) * Math.PI / 180) / dt;    // rad/s
      const aLat = speedMs * yawRate;                            // m/s²
      if (aLat >= this.thresholds.turnThresholdMs2 && imuConfirms) {
        this.onEvent({ type: DrivingEventType.SHARP_TURN, timestamp: new Date(), durationMs: imuPeakDurationMs, ...peakFields });
      }
    }

    // Advance the window.
    this.motionPrevMs = now;
    this.motionPrevSpeedMs = speedMs;
    if (headingDeg >= 0) this.motionPrevHeadingDeg = headingDeg;
    this.peakHorizAccelMs2 = 0;
    this.peakHoriz2d = null;
    this.aboveConfirmSinceMs = null;
    this.peakStreakStartMs = null;
    this.peakDurationMs = 0;
    this.windowHorizSum = { a: 0, b: 0 };
    this.windowHorizCount = 0;
  }

  /** Latest sample's force in the vehicle frame, or null while the frame is unresolved. */
  private vehicleFrameForce() {
    return this.latestHoriz2d ? this.vehicleFrame.resolve(this.latestHoriz2d) : null;
  }

  // ─── Accelerometer handler — cross-confirm + fraud telemetry (CAR-156: no severity) ──

  private handleAccel(data: { x: number; y: number; z: number }) {
    // Step 1: EMA low-pass filter to isolate slow-changing static gravity.
    this.gravity.x = LPF_ALPHA * this.gravity.x + (1 - LPF_ALPHA) * data.x;
    this.gravity.y = LPF_ALPHA * this.gravity.y + (1 - LPF_ALPHA) * data.y;
    this.gravity.z = LPF_ALPHA * this.gravity.z + (1 - LPF_ALPHA) * data.z;

    // Step 2: gravity-removed dynamic acceleration (g units, expo convention).
    const dynX = data.x - this.gravity.x;
    const dynY = data.y - this.gravity.y;
    const dynZ = data.z - this.gravity.z;

    this.onAccelSample?.(data); // raw, pre-gravity-removal — see onAccelSample doc
    this.lastAccelSampleAtMs = Date.now();

    // Step 3: project out the component along gravity (vertical); what remains is the
    // horizontal force. Its magnitude does not depend on the phone's yaw — so
    // brake/accel/turn forces are captured regardless of how the phone is mounted —
    // and its direction within that plane is what the vehicle frame resolves.
    const basis = horizontalBasis(this.gravity);
    this.latestBasis = basis;
    if (!basis) {
      // Gravity has not converged. There is no horizontal plane to speak of yet, so
      // there is nothing to measure — not a zero measurement.
      this.latestHoriz2d = null;
      return;
    }
    const horiz = projectHorizontal({ x: dynX, y: dynY, z: dynZ }, basis);
    this.latestHoriz2d = horiz;
    const horizMs2 = Math.hypot(horiz.a, horiz.b) * MS2_PER_G; // g → m/s²

    // One window's worth of horizontal force; detectMotionEvents pairs its mean with
    // the GPS-measured speed change to teach the estimator which way is forward.
    this.windowHorizSum = { a: this.windowHorizSum.a + horiz.a, b: this.windowHorizSum.b + horiz.b };
    this.windowHorizCount++;

    // Track the continuous streak at/above the cross-confirm threshold first, so a
    // peak recorded on this sample can capture the streak it actually belongs to.
    const nowMs = Date.now();
    if (horizMs2 >= IMU_CONFIRM_MS2) {
      if (this.aboveConfirmSinceMs === null) this.aboveConfirmSinceMs = nowMs;
    } else {
      this.aboveConfirmSinceMs = null;
    }

    if (horizMs2 > this.peakHorizAccelMs2) {
      this.peakHorizAccelMs2 = horizMs2;
      this.peakHoriz2d = horiz;
      this.peakStreakStartMs = this.aboveConfirmSinceMs;
    }

    // durationMs grows only while still inside the streak that holds the peak —
    // a rough-road streak elsewhere in the window must not out-report the brake.
    if (this.peakStreakStartMs !== null && this.aboveConfirmSinceMs === this.peakStreakStartMs) {
      this.peakDurationMs = nowMs - this.peakStreakStartMs;
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

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
