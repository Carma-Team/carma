/**
 * @file PhoneUsageManager.ts
 * @owner May Hajbi — driving-sdk maintainer
 * @brief Measures phone distraction as two mutually exclusive per-second counters read
 * from the gyroscope: seconds carrying a tap cadence, and seconds the phone was merely
 * being moved. Does not count a mounted phone running a navigation app behind the host.
 *
 * @description
 * IMU-based active interaction detector — v2.0.
 * Detects active phone handling from gyroscope rotation. Replaces a v1.x AppState-only approach that
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
 * v2.0: two counters instead of one, read from the gyroscope alone. Acceleration is no
 * longer an input to either decision — a single-sample force threshold cannot tell a
 * finger from a pothole, which is what the accelerometer tap proxy did and why its
 * count is gone.
 *
 * Gyroscope samples are pushed in via pushGyroSample(). They feed a paired-peak tap
 * detector (US11932257B2): simultaneous rotation on the two in-plane axes, twice in
 * quick succession, is what a finger on glass produces and what a chassis jolt does
 * not. Repetition of that signature within a second is a typing cadence, which is what
 * the screen-interaction counter now measures.
 *
 * Emitted once per second via onInteractionData, as a delta since the previous emission
 * (CAR-175) — never a running total:
 *   - screenInteractionSeconds  1 if this second carried a tap cadence, else 0
 *   - phoneMotionSeconds        1 if the phone was being moved this second and no
 *                               cadence was seen — the two are mutually exclusive and
 *                               screen interaction wins, so a second is never both
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
// ROTATION_VARIANCE_THRESHOLD ((rad/s)²):
//   A phone at rest — mounted, pocketed, on a seat — turns only with the vehicle.
//   A phone being handled turns independently of it, and the variance of angular
//   speed over the window is what separates the two.
//   Provisional, no drive-test data behind it yet (CAR-183 collects it).
//
//   ⚠️ This number was previously a ceiling, not a floor: it vetoed an
//   acceleration-based hand-held read when rotation said the phone was tumbling.
//   The value is carried over deliberately — CAR-183 fits it and the tap band from
//   the same labelled set — but its meaning is now the opposite one.
const ROTATION_VARIANCE_THRESHOLD = 0.5;

// Rolling variance window: 10 samples at 10 Hz = 1-second analysis window.
const VARIANCE_WINDOW_SIZE = 10;

// Matches the 1 s analysis window at the expected 10 Hz gyro feed.
const GYRO_STALE_MS = 1000;

// ── Gyroscope tap signature (US11932257B2) ────────────────────────────────────
//
// A *paired* rotational kick. A chassis jolt drives mostly the vertical accelerometer
// axis through the suspension, while a finger tap rotates the phone slightly about both
// in-plane axes at once, because the hand's grip resists it. Pairs, not force, is the
// distinction — which is why a single-sample force threshold, the approach this
// replaced, could not tell a finger from a pothole.
//
// The band is the patent's own worked example. Provisional, exactly like
// ROTATION_VARIANCE_THRESHOLD above — no drive-test data yet (CAR-183 collects it).
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
  /** Whether this second carried a tap cadence (0 or 1) — a delta, not a running total. */
  screenInteractionSeconds: number;
  /**
   * Whether the phone was being moved this second without a tap cadence (0 or 1) — a
   * delta, not a running total. Mutually exclusive with the counter above: a second
   * showing both is screen interaction, never phone motion.
   */
  phoneMotionSeconds: number;
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
 * Raw rotational features behind the two counters, over the same 1-second window.
 * Exposed for calibration and for classifiers that want the numbers rather than the
 * decision.
 */
export interface MotionFeatures {
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

  // Angular-speed window covering one second at the expected 10 Hz feed. Fed by
  // pushGyroSample() rather than a subscription of its own.
  private rotationWindow: number[] = [];
  private screenInteractionSeconds = 0;
  private phoneMotionSeconds = 0;
  private lastGyroMs = 0;
  // Tap-signature state. `wasPairing` is edge detection: one physical kick spans several
  // 10 Hz samples, and counting each of them would turn one tap into a burst — a pair is
  // registered on the sample that *enters* the band, not on every sample inside it.
  private wasPairing = false;
  private lastPairAtMs = 0;
  // Completion times of taps inside the analysis window, trimmed by age on read so the
  // count describes the same second as the variance terms beside it.
  private tapPairTimes: number[] = [];
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  // Last speed the host reported. Stored and passed through untouched — no threshold
  // and no weighting here, both of which are scoring decisions outside this SDK.
  private speedKmh = 0;
  // True while the current stretch has already been judged distracted — gates
  // PHONE_USAGE to one emission per pickup, not one per second.
  private isDistractedStretchOpen = false;

  constructor(
    onEvent: (event: DrivingEvent) => void,
    onInteractionData: (data: InteractionData) => void,
  ) {
    this.onEvent = onEvent;
    this.onInteractionData = onInteractionData;
  }

  public start(): void {
    this.isActive = true;
    this.screenInteractionSeconds = 0;
    this.phoneMotionSeconds = 0;
    this.lastGyroMs = 0;
    this.wasPairing = false;
    this.lastPairAtMs = 0;
    this.tapPairTimes = [];
    this.rotationWindow = [];
    this.speedKmh = 0;

    // No sensor subscription of its own — the gyroscope arrives through
    // pushGyroSample(), and nothing here reads the accelerometer any more.
    this.startTickTimer();

    console.log('[SDK-Phone] v2.0 started. rotation_variance_threshold=', ROTATION_VARIANCE_THRESHOLD);
  }

  public stop(): void {
    this.isActive = false;
    this.stopTickTimer();
    console.log(
      '[SDK-Phone] v2.0 stopped.',
      `screenInteractionSeconds=${this.screenInteractionSeconds}`,
      `phoneMotionSeconds=${this.phoneMotionSeconds}`,
    );
  }

  public getSnapshot(): InteractionData {
    return {
      screenInteractionSeconds: this.screenInteractionSeconds,
      phoneMotionSeconds: this.phoneMotionSeconds,
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
   * Feed one gyroscope sample (rad/s per axis). Expected at 10 Hz, so the window
   * covers one second.
   *
   * Push-based on purpose: the host is expected to already have the gyroscope
   * subscribed for other detection, and a second subscription would spend battery on
   * a sensor that is running anyway. Not calling this is supported — every feature
   * stays empty and both counters stay at zero, which is what a device with no
   * gyroscope reports.
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
      rotationRateMean: n === 0 ? 0 : window.reduce((s, v) => s + v, 0) / n,
      rotationVariance: this.computeVariance(window),
      rotationSampleCount: n,
      gyroTapPairs: stale ? 0 : this.tapPairTimes.length,
    };
  }

  private computeVariance(window: number[]): number {
    const n = window.length;
    if (n < 2) return 0;
    const mean = window.reduce((s, v) => s + v, 0) / n;
    return window.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  }

  private startTickTimer(): void {
    this.stopTickTimer();
    // Ticks every second for as long as this manager runs, foreground or background.
    //
    // The two counters are mutually exclusive and screen interaction wins: a tap
    // cadence necessarily moves the phone, so without the precedence a second of
    // typing would count twice, once against each baseline.
    //
    // A window with no gyro samples computes to zero variance and zero pairs, so a
    // device without a gyroscope reports nothing rather than needing a branch here.
    this.tickTimer = setInterval(() => {
      if (!this.isActive) return;
      const motion = this.getMotionFeatures();
      // A completed paired-peak signature in this window is the cadence — one tap is
      // already two rotational kicks, and what separates typing from a single knock is
      // that the signature repeats at all.
      const isScreenInteraction = motion.gyroTapPairs > 0;
      const isPhoneMotion = !isScreenInteraction && motion.rotationVariance >= ROTATION_VARIANCE_THRESHOLD;

      if (isScreenInteraction) this.screenInteractionSeconds++;
      if (isPhoneMotion) this.phoneMotionSeconds++;

      // Fire PHONE_USAGE once per distracted stretch, not once per tick.
      if (isScreenInteraction || isPhoneMotion) {
        if (!this.isDistractedStretchOpen) {
          this.isDistractedStretchOpen = true;
          this.onEvent({ type: DrivingEventType.PHONE_USAGE, timestamp: new Date(), severity: 0.5 });
        }
      } else {
        this.isDistractedStretchOpen = false;
      }

      // One emission per tick regardless of outcome (CAR-175) — a delta, not a snapshot.
      this.onInteractionData({
        screenInteractionSeconds: isScreenInteraction ? 1 : 0,
        phoneMotionSeconds: isPhoneMotion ? 1 : 0,
        speedKmh: this.speedKmh,
      });
    }, 1000);
  }

  private stopTickTimer(): void {
    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    this.isDistractedStretchOpen = false;
  }
}
