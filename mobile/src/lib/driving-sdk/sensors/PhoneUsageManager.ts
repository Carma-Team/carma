/**
 * @file PhoneUsageManager.ts
 * @owner May Hajbi — driving-sdk maintainer
 * @brief Detects a phone actively held in the hand, using IMU variance and a glass-tap proxy.
 * Reports tap count and hand-held seconds, and deliberately does not count a mounted phone
 * running a navigation app in the background.
 *
 * @description
 * IMU-based active interaction detector — v1.9.
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
 * Gyroscope samples can be pushed in via pushGyroSample(); the resulting rotational
 * features are exposed through getMotionFeatures() alongside the acceleration variance.
 * A hand stabilises orientation, a phone loose on a seat tumbles — CAR-174 uses that to
 * veto the acceleration-only hand-held read when rotation says otherwise.
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
import { Accelerometer } from 'expo-sensors';
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
//   is a tumbling phone, not a hand. Provisional — no drive-test data yet (CAR-31),
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
}

export class PhoneUsageManager {
  private isActive = false;
  private onEvent: (event: DrivingEvent) => void;
  private onInteractionData: (data: InteractionData) => void;
  private accelSub: { remove: () => void } | null = null;

  private magnitudeWindow: number[] = [];
  // Angular-speed window, same span as magnitudeWindow so both features describe the
  // same second. Fed by pushGyroSample() rather than a subscription of its own.
  private rotationWindow: number[] = [];
  private touchEpochs = 0;
  private touchEpochsThisTick = 0;
  private screenInteractionSeconds = 0;
  private lastEpochMs = 0;
  private lastGyroMs = 0;
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
    this.magnitudeWindow = [];
    this.rotationWindow = [];
    this.speedKmh = 0;

    Accelerometer.setUpdateInterval(100); // 10 Hz
    this.accelSub = Accelerometer.addListener(({ x, y, z }) => this.handleAccel(x, y, z));

    this.startHandheldTimer();

    console.log('[SDK-Phone] v1.9 started. variance_threshold=', HANDHELD_VARIANCE_THRESHOLD);
  }

  public stop(): void {
    this.isActive = false;
    this.accelSub?.remove();
    this.accelSub = null;
    this.stopHandheldTimer();
    console.log(
      '[SDK-Phone] v1.9 stopped.',
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
    this.lastGyroMs = Date.now();
    this.rotationWindow.push(Math.sqrt(x * x + y * y + z * z));
    if (this.rotationWindow.length > VARIANCE_WINDOW_SIZE) this.rotationWindow.shift();
  }

  /** Current window's raw motion features. See {@link MotionFeatures}. */
  public getMotionFeatures(): MotionFeatures {
    // A stopped gyro feed leaves rotationWindow holding its last live samples forever —
    // treat samples older than the window itself as if none had been pushed.
    const stale = this.rotationWindow.length > 0 && Date.now() - this.lastGyroMs > GYRO_STALE_MS;
    const window = stale ? [] : this.rotationWindow;
    const n = window.length;
    return {
      accelVariance: this.computeVariance(this.magnitudeWindow),
      rotationRateMean: n === 0 ? 0 : window.reduce((s, v) => s + v, 0) / n,
      rotationVariance: this.computeVariance(window),
      rotationSampleCount: n,
    };
  }

  private handleAccel(x: number, y: number, z: number): void {
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
    // No gyro pushed yet → fall back to acceleration alone.
    this.handheldTimer = setInterval(() => {
      if (!this.isActive) return;
      const motion = this.getMotionFeatures();
      const isHandheld =
        motion.accelVariance > HANDHELD_VARIANCE_THRESHOLD &&
        (motion.rotationSampleCount === 0 || motion.rotationVariance < ROTATION_VARIANCE_MAX_THRESHOLD);

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
