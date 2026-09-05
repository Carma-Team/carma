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
 * The gyroscope arrives through pushGyroSample(), fed by the subscription the host
 * already runs for motion-event detection — one physical sensor, one listener (CAR-325).
 *
 * @remarks
 * This file is the coordinator, not the detection (CAR-328). The signal lives in
 * `phone-usage/tapSignature.ts`: angular-speed statistics and the paired-peak tap
 * signature (US11932257B2), over the window `variance.ts` defines. What stays here is
 * everything it does not own — the lifecycle, the per-second tick, the emission
 * accounting, and the two-counter decision itself.
 *
 * A paired-peak signature is simultaneous rotation on the two in-plane axes, twice in
 * quick succession — what a finger on glass produces and what a chassis jolt does not.
 * Repetition of it within a second is a typing cadence, which is what the
 * screen-interaction counter measures. Rotation variance on its own, with no cadence
 * behind it, is the phone merely being moved.
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
import {
  TapSignatureDetector,
  ROTATION_VARIANCE_THRESHOLD,
  RotationFeatures,
} from './phone-usage/tapSignature';

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
 *
 * Since v2.0 the rotational terms are the whole feature set — acceleration is no longer
 * read here — so this is the detector's own shape under the name the SDK exports.
 */
export type MotionFeatures = RotationFeatures;

export class PhoneUsageManager {
  private isActive = false;
  private onEvent: (event: DrivingEvent) => void;
  private onInteractionData: (data: InteractionData) => void;

  private rotation = new TapSignatureDetector();

  private screenInteractionSeconds = 0;
  private phoneMotionSeconds = 0;
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
    this.rotation.reset();
    this.screenInteractionSeconds = 0;
    this.phoneMotionSeconds = 0;
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
    this.rotation.push(x, y, z);
  }

  /** Current window's raw motion features. See {@link MotionFeatures}. */
  public getMotionFeatures(): MotionFeatures {
    return this.rotation.features();
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
