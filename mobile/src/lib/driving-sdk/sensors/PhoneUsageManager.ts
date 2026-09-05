/**
 * @file PhoneUsageManager.ts
 * @owner May Hajbi — driving-sdk maintainer
 * @brief Detects a phone actively held in the hand, using IMU variance and a glass-tap proxy.
 * Reports tap count and hand-held seconds, and deliberately does not count a mounted phone
 * running a navigation app in the background.
 *
 * @description
 * IMU-based active interaction detector — v1.10.
 * Detects active phone handling via IMU accelerometer-variance analysis and
 * a glass-tap transient proxy. Replaces a v1.x AppState-only approach that
 * caused false positives when the host app ran in the background behind
 * navigation apps (Waze, Google Maps) with the phone mounted on the dashboard.
 *
 * v1.8: the discrete PHONE_USAGE event was gated on IMU variance too — a bare
 * AppState background/inactive transition (Siri, incoming call, Control Center)
 * stopped counting by itself.
 *
 * v1.9: AppState is gone from this class entirely. Whether the host app is in the
 * foreground says nothing about whether the phone is in a hand, and treating it as
 * a gate meant a driver holding the phone while looking at the host app's own screen
 * measured as zero. The IMU answers the only question this class asks.
 *
 * v1.10: the class subscribes to nothing. Both IMU streams arrive through
 * pushAccelSample() and pushGyroSample(), fed by whichever subscription the host already
 * runs for motion-event detection — one physical sensor, one listener (CAR-325).
 *
 * The rotational features are exposed through getMotionFeatures() alongside the
 * acceleration variance.
 * A hand stabilises orientation, a phone loose on a seat tumbles — CAR-174 uses that to
 * veto the acceleration-only hand-held read when rotation says otherwise.
 *
 * Those samples also feed a paired-peak tap detector (US11932257B2): simultaneous
 * rotation on the two in-plane axes, twice in quick succession, is what a finger on
 * glass produces and what a pothole does not. Its count is reported as a raw feature,
 * never as a distraction decision.
 *
 * Emitted once per second via onInteractionData, as a delta since the previous emission
 * (CAR-175) — never a running total:
 *   - touchEpochs              sharp single-sample acceleration transients this tick
 *                               (glass-tap proxy; also fires on foreground touch events)
 *   - screenInteractionSeconds  1 if this second was judged hand-held, else 0
 *                               (low variance = vehicle-mounted → not counted)
 *   - speedKmh                  vehicle speed last reported via updateSpeed(), passed
 *                               through as-is so the host can relate handling to motion
 *
 * @remarks Hardware-abstraction only. Threshold constants are IMU calibration values,
 * not app-specific scoring weights. They require empirical drive-test validation
 * before production launch.
 */
import { DrivingEventType, DrivingEvent } from '@/lib/driving-sdk/types';

// ── IMU calibration constants ─────────────────────────────────────────────────
//
// HANDHELD_VARIANCE_THRESHOLD (g²):
//   Phone on a vehicle mount → variance ~0.002–0.010 g² (road vibration only).
//   Phone hand-held          → variance ~0.030–0.150 g² (micro hand-movements).
//   0.025 g² gives a comfortable separation margin.
//   Requires empirical calibration before Sprint+1 — see RFC-001 §4.3.
const HANDHELD_VARIANCE_THRESHOLD = 0.025;

// ROTATION_VARIANCE_MAX_THRESHOLD ((rad/s)²):
//   A hand stabilises orientation; a phone loose on the seat tumbles. Below this,
//   rotation confirms accelVariance's hand-held read; at/above it, the accel spike
//   is a tumbling phone, not a hand. Provisional — no drive-test data yet (CAR-183),
//   same calibration caveat as the threshold above.
const ROTATION_VARIANCE_MAX_THRESHOLD = 0.5;

// GLASS_TAP_MAGNITUDE_THRESHOLD (g):
//   A finger tap on glass/screen produces a sharp transient of 1.8–3.0 g total
//   magnitude. Road bumps rarely reach 1.8 g with the same sharp onset profile.
//   The 1 500 ms inter-epoch cooldown prevents one physical tap from registering
//   multiple times across the 10 Hz sample stream.
const GLASS_TAP_MAGNITUDE_THRESHOLD = 1.8;
const EPOCH_COOLDOWN_MS = 1500;

// Rolling variance window: 10 samples at 10 Hz = 1-second analysis window.
const VARIANCE_WINDOW_SIZE = 10;

// Matches the 1 s analysis window at the expected 10 Hz gyro feed.
const GYRO_STALE_MS = 1000;

// ── Gyroscope tap signature (US11932257B2) ────────────────────────────────────
//
// The accelerometer tap proxy above thresholds one number — total magnitude over 1.8 g,
// axis-blind — so a pothole crossing that magnitude reads exactly like a finger. The
// patent measures something else entirely: a *paired* rotational kick. A chassis jolt
// drives mostly the vertical accelerometer axis through the suspension, while a finger
// tap rotates the phone slightly about both in-plane axes at once, because the hand's
// grip resists it. Pairs, not force, is the distinction.
//
// The band is the patent's own worked example. Provisional, exactly like
// ROTATION_VARIANCE_MAX_THRESHOLD above — no drive-test data yet (CAR-183 collects it).
const TAP_PEAK_MIN_RAD_S = 0.2;
const TAP_PEAK_MAX_RAD_S = 0.7;

// A tap is two qualifying pairs this close together — the second kick as the finger
// lifts or the next character is typed.
//
// ponytail: 10 Hz gyro puts a hard floor of 100 ms under this. The patent's repeat gap
// runs as low as "tens of milliseconds", so a real gap at that end lands inside one
// sample and no value here recovers it. The fix would be a higher sample rate, which is
// a battery cost and Dan's call (CAR-260) — not a threshold change.
const TAP_REPEAT_GAP_MS = 400;

export interface InteractionData {
  /** Touch-epoch transients since the previous emission — a delta, not a running total. */
  touchEpochs: number;
  /** Whether this second was judged hand-held (0 or 1) — a delta, not a running total. */
  screenInteractionSeconds: number;
  /**
   * Vehicle speed (km/h) as last reported by the host at the moment this data was
   * emitted, or 0 if the host never reported one. Reported, never interpreted —
   * what a speed means for a given second is the host's decision, not the SDK's.
   *
   * Resolution is bounded by the host's own speed source, not by this class: with
   * GPS-derived speed, expect a fresh value every few seconds rather than every
   * second, and a stretch of identical values in between.
   */
  speedKmh: number;
}

/**
 * Raw motion features behind the hand-held decision, over the same 1-second window.
 * Exposed for calibration and for classifiers that need more than acceleration
 * variance — a hand stabilises orientation, a phone loose on a seat tumbles, and
 * only the rotational terms separate those two. The hand-held decision (CAR-174)
 * reads both: high accelVariance with low rotationVariance.
 */
export interface MotionFeatures {
  /** Variance of total acceleration magnitude (g²). */
  accelVariance: number;
  /** Mean angular speed over the window (rad/s). */
  rotationRateMean: number;
  /** Variance of angular speed over the window ((rad/s)²). */
  rotationVariance: number;
  /** Samples backing the rotational terms — 0 when the device has no gyroscope. */
  rotationSampleCount: number;
  /**
   * Paired-peak tap signatures completed in this window (US11932257B2). A raw count of
   * what the gyroscope saw, not a judgement about distraction — what a tap is worth is
   * the consuming application's decision.
   */
  gyroTapPairs: number;
}

export class PhoneUsageManager {
  private isActive = false;
  private onEvent: (event: DrivingEvent) => void;
  private onInteractionData: (data: InteractionData) => void;

  private magnitudeWindow: number[] = [];
  // Angular-speed window, same span as magnitudeWindow so both features describe the
  // same second. Fed by pushGyroSample() rather than a subscription of its own.
  private rotationWindow: number[] = [];
  private touchEpochs = 0;
  private touchEpochsThisTick = 0;
  private screenInteractionSeconds = 0;
  private lastEpochMs = 0;
  private lastGyroMs = 0;
  // Tap-signature state. `wasPairing` is edge detection: one physical kick spans several
  // 10 Hz samples, and counting each of them would turn one tap into a burst — a pair is
  // registered on the sample that *enters* the band, not on every sample inside it.
  private wasPairing = false;
  private lastPairAtMs = 0;
  // Completion times of taps inside the analysis window, trimmed by age on read so the
  // count describes the same second as the variance terms beside it.
  private tapPairTimes: number[] = [];
  private handheldTimer: ReturnType<typeof setInterval> | null = null;
  // Last speed the host reported. Stored and passed through untouched — no threshold
  // and no weighting here, both of which are scoring decisions outside this SDK.
  private speedKmh = 0;
  // True while the current stretch has already been confirmed hand-held
  // (variance > threshold) — gates PHONE_USAGE to one emission per pickup, not per second.
  private isHandheldStretchOpen = false;

  constructor(
    onEvent: (event: DrivingEvent) => void,
    onInteractionData: (data: InteractionData) => void,
  ) {
    this.onEvent = onEvent;
    this.onInteractionData = onInteractionData;
  }

  public start(): void {
    this.isActive = true;
    this.touchEpochs = 0;
    this.touchEpochsThisTick = 0;
    this.screenInteractionSeconds = 0;
    this.lastEpochMs = 0;
    this.lastGyroMs = 0;
    this.wasPairing = false;
    this.lastPairAtMs = 0;
    this.tapPairTimes = [];
    this.magnitudeWindow = [];
    this.rotationWindow = [];
    this.speedKmh = 0;

    this.startHandheldTimer();

    console.log('[SDK-Phone] v1.10 started. variance_threshold=', HANDHELD_VARIANCE_THRESHOLD);
  }

  public stop(): void {
    this.isActive = false;
    this.stopHandheldTimer();
    console.log(
      '[SDK-Phone] v1.10 stopped.',
      `touchEpochs=${this.touchEpochs}`,
      `screenInteractionSeconds=${this.screenInteractionSeconds}`,
    );
  }

  public getSnapshot(): InteractionData {
    return {
      touchEpochs: this.touchEpochs,
      screenInteractionSeconds: this.screenInteractionSeconds,
      speedKmh: this.speedKmh,
    };
  }

  /**
   * Report the current vehicle speed (km/h). Call it as often as the host's speed
   * source updates; the most recent value is attached to every emission until the
   * next call. Hosts should report 0 rather than a stale reading when their source
   * goes quiet, since this class cannot tell "still moving" from "no fix".
   */
  public updateSpeed(kmh: number): void {
    this.speedKmh = kmh;
  }

  /**
   * Feed one gyroscope sample (rad/s per axis). Expected at the accelerometer's
   * 10 Hz so both windows cover the same second.
   *
   * Push-based on purpose: the host is expected to already have the gyroscope
   * subscribed for other detection, and a second subscription would spend battery
   * on a sensor that is running anyway. Not calling this is supported — the
   * rotational features simply stay empty.
   */
  public pushGyroSample(x: number, y: number, z: number): void {
    if (!this.isActive) return;
    const now = Date.now();
    // A gap wider than the analysis window means every held sample predates it — drop
    // them here rather than in the reader, or the first push after the gap resets
    // lastGyroMs and makes a window of entirely pre-gap samples read as fresh again.
    if (this.lastGyroMs !== 0 && now - this.lastGyroMs > GYRO_STALE_MS) {
      this.rotationWindow = [];
      // The same reasoning for the pair state: a kick either side of a gap this wide is
      // not one tap, and carrying `wasPairing` across it would fabricate an edge.
      this.wasPairing = false;
      this.lastPairAtMs = 0;
    }
    this.lastGyroMs = now;
    this.rotationWindow.push(Math.sqrt(x * x + y * y + z * z));
    if (this.rotationWindow.length > VARIANCE_WINDOW_SIZE) this.rotationWindow.shift();
    this.trackTapSignature(x, y, now);
  }

  /**
   * One step of the paired-peak detector: X and Y rotating together, each inside the
   * band, twice within TAP_REPEAT_GAP_MS. The Z axis is deliberately not read — a tap
   * rotates the phone in its own plane, and including Z would let a turn of the whole
   * vehicle qualify.
   */
  private trackTapSignature(x: number, y: number, atMs: number): void {
    const inBand = (v: number) => {
      const m = Math.abs(v);
      return m >= TAP_PEAK_MIN_RAD_S && m <= TAP_PEAK_MAX_RAD_S;
    };
    const pairing = inBand(x) && inBand(y);

    // Rising edge only — see wasPairing.
    if (pairing && !this.wasPairing) {
      if (this.lastPairAtMs !== 0 && atMs - this.lastPairAtMs <= TAP_REPEAT_GAP_MS) {
        this.tapPairTimes.push(atMs);
        // Consumed: the next tap needs two fresh pairs, so a long drumming stretch
        // counts once per pair rather than once per sample after the first.
        this.lastPairAtMs = 0;
      } else {
        this.lastPairAtMs = atMs;
      }
    }
    this.wasPairing = pairing;
  }

  /** Current window's raw motion features. See {@link MotionFeatures}. */
  public getMotionFeatures(): MotionFeatures {
    // A gyro feed that has gone quiet since the last push (not just gapped mid-stream)
    // still holds those samples until the next pushGyroSample() call clears them —
    // treat them as if none had been pushed rather than wait for a push that may not come.
    const now = Date.now();
    const stale = this.rotationWindow.length > 0 && now - this.lastGyroMs > GYRO_STALE_MS;
    const window = stale ? [] : this.rotationWindow;
    const n = window.length;
    // Same second as the variance terms: the window is VARIANCE_WINDOW_SIZE samples at
    // the expected 10 Hz, so its span in milliseconds is what ages a tap out.
    const windowMs = VARIANCE_WINDOW_SIZE * 100;
    this.tapPairTimes = this.tapPairTimes.filter((t) => now - t < windowMs);
    return {
      accelVariance: this.computeVariance(this.magnitudeWindow),
      rotationRateMean: n === 0 ? 0 : window.reduce((s, v) => s + v, 0) / n,
      rotationVariance: this.computeVariance(window),
      rotationSampleCount: n,
      gyroTapPairs: stale ? 0 : this.tapPairTimes.length,
    };
  }

  /**
   * Feed one accelerometer sample (m/s^2 per axis, gravity still in it — the resting
   * ~1 g baseline is what the tap threshold is set against). Expected at 10 Hz,
   * the same cadence as the gyroscope so both windows cover the same second.
   *
   * Push-based for the same reason as pushGyroSample: the host already has the
   * accelerometer subscribed for motion-event detection, and a second listener on one
   * physical sensor is battery spent for nothing (CAR-325). No staleness handling to
   * match the gyroscope's — that guards a host feeding from a source that can go quiet
   * independently, whereas this stream starts and stops with the one the host's own
   * detection depends on. Samples arriving outside a trip fall on the isActive guard.
   */
  public pushAccelSample(x: number, y: number, z: number): void {
    if (!this.isActive) return;
    const mag = Math.sqrt(x * x + y * y + z * z);

    this.magnitudeWindow.push(mag);
    if (this.magnitudeWindow.length > VARIANCE_WINDOW_SIZE) this.magnitudeWindow.shift();

    // Glass-tap proxy: sharp transient well above the resting ~1 g baseline.
    const now = Date.now();
    if (mag > GLASS_TAP_MAGNITUDE_THRESHOLD && now - this.lastEpochMs > EPOCH_COOLDOWN_MS) {
      this.touchEpochs++;
      this.touchEpochsThisTick++;
      this.lastEpochMs = now;
    }
  }

  private computeVariance(window: number[]): number {
    const n = window.length;
    if (n < 2) return 0;
    const mean = window.reduce((s, v) => s + v, 0) / n;
    return window.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  }

  private startHandheldTimer(): void {
    this.stopHandheldTimer();
    // Tick every second for as long as this manager runs, foreground or background.
    // Hand-held requires high acceleration variance AND low rotation variance (CAR-174) —
    // a phone loose on a seat also bounces, but only a hand keeps orientation stable.
    // No gyro pushed yet → rotationVariance computes to 0 (see computeVariance, n<2),
    // which always clears the threshold below, so this falls back to acceleration alone
    // without a separate branch for it.
    this.handheldTimer = setInterval(() => {
      if (!this.isActive) return;
      const motion = this.getMotionFeatures();
      const isHandheld =
        motion.accelVariance > HANDHELD_VARIANCE_THRESHOLD &&
        motion.rotationVariance < ROTATION_VARIANCE_MAX_THRESHOLD;

      if (isHandheld) {
        this.screenInteractionSeconds++;
        // Fire PHONE_USAGE once per hand-held stretch, not once per tick — this is the
        // IMU-confirmed signal replacing the old "any AppState change" trigger.
        if (!this.isHandheldStretchOpen) {
          this.isHandheldStretchOpen = true;
          this.onEvent({ type: DrivingEventType.PHONE_USAGE, timestamp: new Date(), severity: 0.5 });
        }
      } else {
        this.isHandheldStretchOpen = false;
      }

      // One emission per tick regardless of outcome (CAR-175) — a delta, not a snapshot.
      this.onInteractionData({
        touchEpochs: this.touchEpochsThisTick,
        screenInteractionSeconds: isHandheld ? 1 : 0,
        speedKmh: this.speedKmh,
      });
      this.touchEpochsThisTick = 0;
    }, 1000);
  }

  private stopHandheldTimer(): void {
    if (this.handheldTimer !== null) {
      clearInterval(this.handheldTimer);
      this.handheldTimer = null;
    }
    this.isHandheldStretchOpen = false;
  }
}
