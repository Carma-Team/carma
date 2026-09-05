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
 * @remarks
 * This file is the coordinator, not the detection (CAR-328). The two signals live in
 * `phone-usage/`: acceleration variance and the glass-tap proxy in `handheldVariance.ts`,
 * angular-speed statistics and the paired-peak tap signature in `tapSignature.ts`, over
 * the window `variance.ts` defines for both. What stays here is everything neither one
 * owns alone — the lifecycle, the per-second tick, the emission accounting, and the
 * hand-held decision itself, which reads both signals and belongs to neither.
 *
 * A hand stabilises orientation, a phone loose on a seat tumbles — CAR-174 uses that to
 * veto the acceleration-only hand-held read when rotation says otherwise.
 *
 * The paired-peak tap count (US11932257B2) is reported as a raw feature, never as a
 * distraction decision.
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
import { HandheldVarianceDetector, HANDHELD_VARIANCE_THRESHOLD } from './phone-usage/handheldVariance';
import { TapSignatureDetector, ROTATION_VARIANCE_MAX_THRESHOLD } from './phone-usage/tapSignature';

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

  private handheld = new HandheldVarianceDetector();
  private rotation = new TapSignatureDetector();

  private screenInteractionSeconds = 0;
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
    this.handheld.reset();
    this.rotation.reset();
    this.screenInteractionSeconds = 0;
    this.speedKmh = 0;

    this.startHandheldTimer();

    console.log('[SDK-Phone] v1.10 started. variance_threshold=', HANDHELD_VARIANCE_THRESHOLD);
  }

  public stop(): void {
    this.isActive = false;
    this.stopHandheldTimer();
    console.log(
      '[SDK-Phone] v1.10 stopped.',
      `touchEpochs=${this.handheld.touchEpochs}`,
      `screenInteractionSeconds=${this.screenInteractionSeconds}`,
    );
  }

  public getSnapshot(): InteractionData {
    return {
      touchEpochs: this.handheld.touchEpochs,
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
    this.rotation.push(x, y, z);
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
    this.handheld.push(x, y, z);
  }

  /** Current window's raw motion features. See {@link MotionFeatures}. */
  public getMotionFeatures(): MotionFeatures {
    return {
      accelVariance: this.handheld.accelVariance,
      ...this.rotation.features(),
    };
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
        touchEpochs: this.handheld.takeTickEpochs(),
        screenInteractionSeconds: isHandheld ? 1 : 0,
        speedKmh: this.speedKmh,
      });
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
