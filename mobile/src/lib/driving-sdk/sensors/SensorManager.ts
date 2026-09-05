/**
 * @file SensorManager.ts
 * @owner May Hajbi — driving-sdk maintainer
 * @brief Owns the GPS and IMU subscriptions and their lifecycle, accumulates distance
 * and speed from the location stream, and reports on every fix what the sensors are
 * actually delivering.
 *
 * @description
 * Four jobs used to live in this file. Detecting brakes, accelerations and turns is
 * now in `motionEvents.ts`, which is where the reasoning behind the GPS+IMU fusion
 * lives too; this class subscribes to the sensors, decides whether each one counts as
 * live, and hands samples over.
 *
 * **Available means delivering.** A sensor counts as available only while samples are
 * still arriving (SENSOR_STALE_MS), never merely because `isAvailableAsync()` once said
 * yes: a dead listener must read as unavailable rather than as a frozen last value
 * (docs/fraud-detection.md §3.1). Detection is told the answer and does not ask.
 *
 * **Speed survives a gap, up to a point.** expo reports -1 for "speed unavailable", and
 * clamping that to 0 reads as a deceleration that never happened - so the last good
 * reading is held, and decays to 0 once it has been stale long enough that a stop must
 * be reported. A timer drives that decay, because the stream whose silence it covers
 * cannot.
 *
 * The full 10 Hz accelerometer and gyroscope streams are also offered raw to optional
 * `onAccelSample`/`onGyroSample` consumers, so nothing else has to subscribe to a
 * sensor this class already keeps powered.
 *
 * @remarks No server calls — local logic only. Fires callbacks to DrivingSDK.
 */
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import { Accelerometer, Gyroscope } from 'expo-sensors';
import { DrivingEventType, DrivingEvent, MotionThresholds, SensorUpdate, SENSOR_STALE_MS } from '@/lib/driving-sdk/types';
// Importing this registers the background-location TaskManager task at module load.
import {
  DRIVING_SDK_LOCATION_TASK, setLocationHandler, setLocationErrorHandler,
} from '@/lib/driving-sdk/sensors/locationTask';
import { yawRateAboutGravity } from '@/lib/driving-sdk/sensors/vehicleFrame';
import { MotionEventDetector } from '@/lib/driving-sdk/sensors/motionEvents';

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

// docs/fraud-detection.md §3.1: a sensor is available only while a subscription is
// actively delivering samples, not merely because isAvailableAsync() once said yes.
// A dead listener (OS killed it, hardware faulted mid-trip) must read as unavailable,
// not as a frozen last value — that's the exact shape CAR-162 is built to distrust.
// Defined in types.ts so a TripValidator can apply the same cutoff to GPS speed.

// One definition, used by start() and by the foreground retry behind it — two copies
// of a config this long drift, and the retry would then ask for a different stream
// than the one that failed.
//
// #17: cloud data shows some devices deliver these ticks at a ~6s median with >15s
// gaps instead of the requested 2s — timeInterval/distanceInterval are hints, not
// guarantees; Android's FusedLocationProviderClient can defer updates under
// battery-saver/Doze or aggressive OEM power management, and a foreground service
// raises priority but doesn't fully override it.
// Tried raising accuracy to BestForNavigation to push cadence further, but on Android
// expo-location's mapAccuracyToPriority maps both High and BestForNavigation to the
// same PRIORITY_HIGH_ACCURACY, and the caller-supplied timeInterval/distanceInterval
// still override the accuracy-derived defaults — so it's a no-op there and only costs
// battery on iOS, where it is a distinct, higher-power tier. Staying on High; #17
// remains open, not fixed by this tier.
const LOCATION_UPDATE_OPTIONS: Location.LocationTaskOptions = {
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
};

export class SensorManager {
  private accelSub: any = null;
  private gyroSub: any = null;
  private lastLocation: any = null;
  private lastValidSpeedMs = 0; // carries forward across expo's -1 "unavailable" ticks
  private lastValidSpeedAtMs = 0; // GPS fix timestamp lastValidSpeedMs was captured at — decays it back to 0 if stale (STALE_SPEED_MS)
  private speedTicker: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  // Generation token for start(). isRunning is one boolean shared by every call, so it
  // cannot tell "stopped" from "stopped and started again": a start() parked on an await
  // would resume into a *newer* run and register a second set of listeners, which stop()
  // never removes. Monotonic on purpose — resetting it would let an old run's token match
  // a new run's and bring the leak straight back.
  private runId = 0;
  private accelAvailable = false;
  private gyroAvailable = false;
  // Wall-clock timestamp of the last delivered sample per sensor — SENSOR_STALE_MS
  // turns "was available at start()" into "is available right now" (§3.1).
  private lastAccelSampleAtMs = 0;
  private lastGyroSampleAtMs = 0;
  // Coverage accounting: wall-clock milliseconds the accelerometer actually delivered
  // samples for, against the wall clock it was asked to. A single boolean cannot
  // separate a sensor that died halfway from one that never started; the ratio can.
  private coverageWindowStartMs = 0;
  private accelLiveMs = 0;
  private backgroundLocationAvailable = false;
  // True only when the accelerometer registration itself threw — distinct from
  // accelAvailable=false meaning "no such hardware". Reported outward so a host can
  // tell the two apart; it no longer feeds the cross-confirm gate, which asks only
  // whether samples are arriving (see imuConfirms below, CAR-320).
  private accelInitFailed = false;
  // True when the location stream could not be started, or the platform stopped it
  // afterwards. The permission flag above cannot carry this: permission can be granted
  // and the start still refused (CAR-326).
  private locationStartFailed = false;
  // Live only while a failed start is waiting for the app to reach the foreground.
  private foregroundRetry: { remove: () => void } | null = null;

  // Everything between an accelerometer sample and a fired event lives here: the
  // gravity estimate, the vehicle-frame learner, the sliding window and its peak.
  // None of that state is read anywhere else, which is what made it a clean seam.
  private motion: MotionEventDetector;
  // Stays here rather than moving with the rest: the gyroscope subscription is this
  // class's, and yaw is reported outward on every update without detection reading
  // it. Null until gravity converges, and null again once the sensor goes stale.
  private latestYawRateRadS: number | null = null;

  private onEvent: (event: DrivingEvent) => void;
  // Raw 10 Hz gyroscope tap. Exists so a second consumer can read rotation without
  // opening its own Gyroscope subscription — the sensor is already powered here, and
  // the onUpdate bundle below only carries yaw at GPS rate (~2 s), far too coarse
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
    this.motion = new MotionEventDetector(onEvent, { ...DEFAULT_MOTION_THRESHOLDS, ...thresholds });
    this.onGyroSample = onGyroSample;
    this.onAccelSample = onAccelSample;
  }

  public async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    const run = ++this.runId;
    this.motion.reset();
    this.lastValidSpeedMs = 0;
    this.lastValidSpeedAtMs = 0;
    this.latestYawRateRadS = null;
    this.accelAvailable = false;
    this.gyroAvailable  = false;
    this.lastAccelSampleAtMs = 0;
    this.lastGyroSampleAtMs  = 0;
    this.resetSensorCoverage();
    this.backgroundLocationAvailable = false;
    this.locationStartFailed = false;
    this.accelInitFailed = false;

    // Deliberately outside the try below: the tick is what keeps speed honest when the
    // location stream is unavailable, which includes the case where starting it failed.
    this.speedTicker = setInterval(() => this.handleSpeedTick(), SPEED_TICK_INTERVAL_MS);

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      // CAR-177: stop() — or a stop() followed by a fresh start() — may have already
      // run while we were awaiting the dialog above (e.g. a Bluetooth disconnect).
      // Every await past this point re-checks that this run is still the current one
      // before doing anything that leaves a subscription or background task running.
      if (run !== this.runId) return;
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
        if (run !== this.runId) return;

        // Feed every location (foreground AND background, via the TaskManager task)
        // through the same accumulation path. High accuracy = GPS only, avoiding
        // network/cell jumps that inflate distance when stationary (D-SDK-3).
        setLocationHandler((loc) => this.handleLocation(loc));
        // A foreground service the platform kills mid-trip reports itself through the
        // task, not through the call that started it — without this the stream simply
        // went quiet, which is indistinguishable from a car standing still.
        setLocationErrorHandler(() => { this.locationStartFailed = true; });
        const alreadyStarted = await Location
          .hasStartedLocationUpdatesAsync(DRIVING_SDK_LOCATION_TASK)
          .catch(() => false);
        if (alreadyStarted) {
          await Location.stopLocationUpdatesAsync(DRIVING_SDK_LOCATION_TASK).catch(() => {});
        }
        if (run !== this.runId) {
          // Detach only when nothing newer is live: if a fresh start() is already
          // running, the handler on record is *its* handler, and clearing it here
          // would blind the trip that is actually in progress.
          if (!this.isRunning) setLocationHandler(null);
          return;
        }
        await this.startLocationUpdates();
        if (run !== this.runId) {
          // Started after the fact. Undo it only when nothing newer is live: stop()
          // already ran and won't come back to clean this up, so we do it ourselves —
          // but a newer run shares this one background task, and stopping it here
          // would kill location tracking for the trip that is actually in progress.
          if (!this.isRunning) {
            setLocationHandler(null);
            await Location.stopLocationUpdatesAsync(DRIVING_SDK_LOCATION_TASK).catch(() => {});
          }
          return;
        }
      } else {
        console.warn('[SensorManager] Location permission denied');
      }
    } catch (err) {
      console.error('[SensorManager] Error starting location:', err);
    }
    if (run !== this.runId) return;

    // Deliberately its own try: a location failure above must not skip IMU
    // registration, and a gyroscope failure below must not misattribute itself
    // to the accelerometer via a shared catch — each sensor fails independently.
    try {
      this.accelAvailable = await Accelerometer.isAvailableAsync();
      if (run !== this.runId) return;
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
    if (run !== this.runId) return;

    try {
      this.gyroAvailable = await Gyroscope.isAvailableAsync();
      if (run !== this.runId) return;
      if (this.gyroAvailable) {
        Gyroscope.setUpdateInterval(100);
        this.lastGyroSampleAtMs = Date.now(); // grace period, see accel above
        this.gyroSub = Gyroscope.addListener(data => {
          // Yaw is rotation about gravity, not about the device's Z axis — those agree
          // only for a phone lying perfectly flat, which is the assumption CAR-167 was
          // filed against. Null while gravity has not converged.
          this.latestYawRateRadS = yawRateAboutGravity(data, this.motion.gravity);
          this.lastGyroSampleAtMs = Date.now();
          this.onGyroSample?.(data);
        });
      }
    } catch (err) {
      console.error('[SensorManager] Error starting gyroscope:', err);
    }
  }

  /**
   * Starts the location stream, recording whether it actually started. Android 12+
   * refuses a foreground-service start from an app that is already in the background,
   * which is precisely the state an automatically started trip begins in: the failure
   * used to reach a console line and nothing else, so the trip ran with no location at
   * all and reported itself as healthy (CAR-326).
   *
   * Its own try, for the same reason the accelerometer below has one: a location
   * failure must not skip the IMU, and it must not be attributed to anything else.
   */
  private async startLocationUpdates(): Promise<void> {
    try {
      await Location.startLocationUpdatesAsync(DRIVING_SDK_LOCATION_TASK, LOCATION_UPDATE_OPTIONS);
      this.locationStartFailed = false;
    } catch (err) {
      console.error('[SensorManager] Could not start location updates:', err);
      this.locationStartFailed = true;
      this.retryWhenForeground();
    }
  }

  /**
   * One more attempt when the app next reaches the foreground, where the platform rule
   * that refused the first one no longer applies. Armed only after a failure, and
   * removed as soon as it fires, so a trip that started cleanly subscribes to nothing.
   *
   * This is the library's only use of AppState, and it is worth saying why: phone-usage
   * measurement deliberately gave it up (CAR-45), because foreground/background is not
   * what it was actually measuring. Here it is — the condition being waited on is
   * literally "the app is in the foreground".
   */
  private retryWhenForeground(): void {
    if (this.foregroundRetry) return;
    // The same generation guard every await in start() carries: a stop(), or a newer
    // start(), retires this attempt rather than letting it resume into a stopped state.
    const run = this.runId;
    this.foregroundRetry = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      this.clearForegroundRetry();
      if (run !== this.runId || !this.isRunning) return;
      // No second retry behind this one: a failure that survives the foreground is not
      // the platform rule this works around, and the flag already reports it.
      void Location
        .startLocationUpdatesAsync(DRIVING_SDK_LOCATION_TASK, LOCATION_UPDATE_OPTIONS)
        .then(() => { if (run === this.runId) this.locationStartFailed = false; })
        .catch((err) => console.error('[SensorManager] Location updates failed in the foreground too:', err));
    });
  }

  private clearForegroundRetry(): void {
    this.foregroundRetry?.remove();
    this.foregroundRetry = null;
  }

  public stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    // Retires the current run: any start() still parked on an await now holds a stale
    // token and will bail at its next guard instead of resuming into this stopped state.
    this.runId++;
    if (this.speedTicker) {
      clearInterval(this.speedTicker);
      this.speedTicker = null;
    }
    this.clearForegroundRetry();
    try {
      setLocationHandler(null);
      setLocationErrorHandler(null);
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
        this.motion.reseedWindow(); // the next fix starts a window on the new clock
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
      ...this.sensorHealth(),
      lat:          loc.coords.latitude,
      lng:          loc.coords.longitude,
      accuracy:     loc.coords.accuracy ?? undefined,
      fixTs:        loc.timestamp,
    });
    // Fire events after onUpdate so the SDK's speed/location is current when stamped.
    this.motion.evaluate(loc, rawSpeed !== null && rawSpeed >= 0 ? rawSpeed : null, this.accelIsLive());
  }

  /**
   * Last known-good speed (m/s), decayed to 0 once it has been stale for
   * STALE_SPEED_MS. `atMs` is the instant to measure staleness against: a GPS fix
   * timestamp on the fix path, wall clock on the tick path. Both are epoch ms —
   * expo-location exports the native timestamp as `timeIntervalSince1970 * 1000`.
   */
  private decayedSpeedMs(atMs: number): number {
    // An anchor ahead of `atMs` can only be a backwards clock step. handleLocation
    // re-anchors on one, but only when a fix arrives to carry the new clock — and iOS
    // sends nothing at all while stationary, so a step with no fix behind it leaves the
    // anchor in the future indefinitely. Treating that as stale is the worse of the two
    // fixes: it emits a 0 mid-drive, which is a stop that never happened. Re-anchoring
    // restarts the countdown from the step instead, so the held speed survives and a
    // real stop after the step is still reported one STALE_SPEED_MS later.
    if (this.lastValidSpeedAtMs > atMs) this.lastValidSpeedAtMs = atMs;
    return (atMs - this.lastValidSpeedAtMs) < STALE_SPEED_MS ? this.lastValidSpeedMs : 0;
  }

  // §3.1: available at start() plus a sample within the last SENSOR_STALE_MS —
  // not just "was present when start() ran".
  private isSensorFresh(lastSampleAtMs: number): boolean {
    return (Date.now() - lastSampleAtMs) < SENSOR_STALE_MS;
  }

  /**
   * Restarts the coverage window without touching the subscriptions. A consumer that
   * keeps sensors running across a phase boundary — validation into a confirmed trip —
   * calls this so the fraction it later reads describes that phase and not the wait
   * before it. `start()` calls it too, so the common case needs nothing.
   */
  public resetSensorCoverage(): void {
    this.coverageWindowStartMs = Date.now();
    this.accelLiveMs = 0;
  }

  /**
   * Fraction of the current window (0–1) during which the accelerometer was
   * delivering samples. 0 means it never delivered one — the same value a device
   * with no accelerometer reports, which `accelAvailable`/`accelInitFailed` are
   * there to tell apart. Anything between 0 and 1 is a sensor that stopped partway.
   */
  private accelCoverage(): number {
    const windowMs = Date.now() - this.coverageWindowStartMs;
    if (windowMs <= 0) return 0;
    return Math.min(1, this.accelLiveMs / windowMs);
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
      ...this.sensorHealth(),
    });
  }

  /** Whether the accelerometer is delivering right now — §3.1, not "was present". */
  private accelIsLive(): boolean {
    return this.accelAvailable && this.isSensorFresh(this.lastAccelSampleAtMs);
  }

  /** Yaw about gravity, or null once the gyroscope has gone stale. */
  private freshYawRate(): number | null {
    return this.isSensorFresh(this.lastGyroSampleAtMs) ? this.latestYawRateRadS : null;
  }

  /**
   * The half of every update that describes the sensors rather than the fix. Both
   * emit paths carry it identically, and they drifted apart once already: a flag
   * added to one of them reported itself only on the path that happened to fire.
   */
  private sensorHealth() {
    const force = this.motion.vehicleFrameForce(this.accelIsLive());
    return {
      longitudinalAccelG: force?.longitudinal ?? null,
      lateralAccelG:      force?.lateral ?? null,
      yawRateRadS:        this.freshYawRate(),
      accelAvailable: this.accelIsLive(),
      gyroAvailable:  this.gyroAvailable && this.isSensorFresh(this.lastGyroSampleAtMs),
      accelCoverage: this.accelCoverage(),
      accelInitFailed: this.accelInitFailed,
      backgroundLocationAvailable: this.backgroundLocationAvailable,
      locationStartFailed: this.locationStartFailed,
    };
  }

  // ─── Accelerometer handler — cross-confirm + fraud telemetry (CAR-156: no severity) ──

  private handleAccel(data: { x: number; y: number; z: number }) {
    this.onAccelSample?.(data); // raw, pre-gravity-removal — see onAccelSample doc

    // Credit the span since the previous sample, but only if the sensor was still
    // considered live across it. A gap wider than SENSOR_STALE_MS is exactly the
    // stretch this metric exists to subtract — crediting it would erase the outage
    // the moment the sensor came back.
    const sampleAtMs = Date.now();
    const gapMs = sampleAtMs - this.lastAccelSampleAtMs;
    if (this.lastAccelSampleAtMs !== 0 && gapMs < SENSOR_STALE_MS) this.accelLiveMs += gapMs;
    this.lastAccelSampleAtMs = sampleAtMs;

    this.motion.pushAccelSample(data);
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
