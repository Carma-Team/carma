/**
 * @file motionEvents.ts
 * @owner May Hajbi — driving-sdk maintainer
 * @brief GPS-triggered brake / acceleration / turn detection, cross-confirmed against the
 * horizontal force the accelerometer actually felt.
 * @description
 * Split out of `SensorManager`, which had grown to carry four unrelated jobs in one file
 * and collided on itself whenever two of them changed in the same week. This holds one of
 * them: everything between an accelerometer sample and a fired motion event.
 *
 * The state here is the reason it is a class rather than a function. Detection is a
 * sliding window: an accelerometer stream at 10 Hz accumulates a peak and a mean, a GPS
 * fix at a far lower rate closes the window and decides, and the vehicle-frame estimate
 * is taught from the pair. None of that state is read anywhere else in the library, which
 * is what makes this a seam rather than a cut.
 *
 * **How an event is decided, and why not per-axis IMU.** Detection is a lightweight
 * GPS+IMU fusion that is independent of how the phone is oriented in the car - vent
 * mount, pocket and cup holder all work:
 *
 * - **Trigger and direction (orientation-free):** GPS. Longitudinal acceleration is
 *   Δspeed / Δt, and lateral is speed × heading-rate.
 * - **Cross-confirm (orientation-free):** the accelerometer. Gravity is removed with an
 *   EMA and what remains is projected onto the horizontal plane; that magnitude is
 *   invariant to rotation about the vertical axis, so it assumes nothing about which
 *   way the phone points. An event fires only if the phone physically felt a force,
 *   which is what rejects pure GPS glitches. The magnitude is a gate, not a
 *   vehicle-frame axis, so it is never reported as event severity (scoring.md §3.4).
 *
 * An earlier version read brake from accel-Y and turns from accel-X. That only works
 * for a phone lying flat with +Y pointing forward - false in any real car mount, so
 * real events went undetected whatever the threshold was set to. It is also why the
 * thresholds here are GPS-measured m/s² and are not comparable to the g-values that
 * spec carried.
 *
 * **Vehicle frame.** Force is resolved out of the phone's own axes into signed
 * longitudinal and lateral components before it leaves here. The geometry is in
 * `vehicleFrame.ts`; forward is learned from agreement between GPS speed changes and
 * the force felt over them, and relearned when the phone moves. Where the frame cannot
 * be resolved the value is `null`, never 0 (docs/fraud-detection.md §3.2).
 *
 * What deliberately stayed behind in `SensorManager`: subscribing to the sensors,
 * deciding whether a sensor counts as live, and reporting any of it outward. This class
 * is told whether the IMU is live; it does not ask.
 */
import type { LocationObject } from 'expo-location';

import { DrivingEventType, DrivingEvent, MotionThresholds } from '@/lib/driving-sdk/types';
import {
  Horizontal2D, HorizontalBasis, VehicleFrameEstimator, horizontalBasis,
  projectHorizontal,
} from '@/lib/driving-sdk/sensors/vehicleFrame';

// ─── EMA for gravity isolation ────────────────────────────────────────────────
// Slow-moving component tracks static gravity so phone tilt isn't read as a force.
// Used to split the accelerometer signal into vertical (along gravity) and horizontal.
const LPF_ALPHA = 0.9;

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

const MS2_PER_G = 9.81;

export class MotionEventDetector {
  // EMA gravity state — initialised to [0, 0, 1] (phone face-up assumption).
  private gravityVec = { x: 0, y: 0, z: 1 };

  // Latest vehicle-frame readings. Null until the frame resolves, never 0: a frame that
  // cannot be resolved has no measurement to report (docs/fraud-detection.md §3.2).
  private latestHoriz2d: Horizontal2D | null = null;
  private latestBasis: HorizontalBasis | null = null;
  private vehicleFrame = new VehicleFrameEstimator();

  // One window's worth of horizontal force, averaged against that window's GPS speed
  // change to teach the estimator which way forward points.
  private windowHorizSum: Horizontal2D = { a: 0, b: 0 };
  private windowHorizCount = 0;

  // The open window's GPS anchors. `motionPrevMs === 0` is the "not seeded yet" sentinel.
  private motionPrevMs = 0;
  private motionPrevSpeedMs = 0;
  private motionPrevHeadingDeg: number | null = null;

  // Strongest horizontal force in the open window, and how long the streak holding it
  // stayed at or above the cross-confirm threshold.
  private peakHorizAccelMs2 = 0;
  private peakHoriz2d: Horizontal2D | null = null;
  private aboveConfirmSinceMs: number | null = null;
  private peakStreakStartMs: number | null = null;
  private peakDurationMs = 0;

  constructor(
    private onEvent: (event: DrivingEvent) => void,
    private thresholds: MotionThresholds,
  ) {}

  /** Everything back to a cold start — a new trip, not a new window. */
  public reset(): void {
    this.gravityVec = { x: 0, y: 0, z: 1 };
    this.latestHoriz2d = null;
    this.latestBasis = null;
    this.vehicleFrame.reset();
    this.motionPrevHeadingDeg = null;
    this.reseedWindow();
  }

  /**
   * Drops the open window without touching the learned frame or the gravity estimate.
   * A backwards clock step makes everything measured across it meaningless, and the
   * next fix starts a fresh window rather than one anchored on the old clock.
   */
  public reseedWindow(): void {
    this.motionPrevMs = 0;
    this.motionPrevSpeedMs = 0;
    this.clearWindow();
  }

  /** The gravity estimate, which the gyroscope needs to resolve yaw about it. */
  public get gravity(): { x: number; y: number; z: number } {
    return this.gravityVec;
  }

  /**
   * Latest sample's force in the vehicle frame, or null while the frame is unresolved.
   * `imuFresh` is the caller's answer to whether the accelerometer is still delivering:
   * a sensor that stopped leaves its last reading behind, and this is a measured force,
   * not a cached one — §3.1's unavailable ≠ zero applies to unavailable ≠ last known
   * just the same.
   */
  public vehicleFrameForce(imuFresh: boolean): { longitudinal: number; lateral: number } | null {
    return this.latestHoriz2d && imuFresh ? this.vehicleFrame.resolve(this.latestHoriz2d) : null;
  }

  // ─── Accelerometer half — cross-confirm + vehicle frame (CAR-156: no severity) ──

  public pushAccelSample(data: { x: number; y: number; z: number }): void {
    // Step 1: EMA low-pass filter to isolate slow-changing static gravity.
    this.gravityVec.x = LPF_ALPHA * this.gravityVec.x + (1 - LPF_ALPHA) * data.x;
    this.gravityVec.y = LPF_ALPHA * this.gravityVec.y + (1 - LPF_ALPHA) * data.y;
    this.gravityVec.z = LPF_ALPHA * this.gravityVec.z + (1 - LPF_ALPHA) * data.z;

    // Step 2: gravity-removed dynamic acceleration (g units, expo convention).
    const dynX = data.x - this.gravityVec.x;
    const dynY = data.y - this.gravityVec.y;
    const dynZ = data.z - this.gravityVec.z;

    // Step 3: project out the component along gravity (vertical); what remains is the
    // horizontal force. Its magnitude does not depend on the phone's yaw — so
    // brake/accel/turn forces are captured regardless of how the phone is mounted —
    // and its direction within that plane is what the vehicle frame resolves.
    const basis = horizontalBasis(this.gravityVec);
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

    // One window's worth of horizontal force; evaluate() pairs its mean with the
    // GPS-measured speed change to teach the estimator which way is forward.
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

  // ─── GPS half — closes the window and decides ────────────────────────────────

  /**
   * GPS-triggered brake / accel / turn detection, cross-confirmed by the IMU.
   * Evaluated over a stable ≥ MOTION_EVAL_MIN_S window to avoid Doppler-jitter noise.
   *
   * `imuLive` is the caller's answer to whether the accelerometer is delivering right
   * now — see the cross-confirm note inside.
   */
  public evaluate(loc: LocationObject, speedMs: number | null, imuLive: boolean): void {
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
      this.clearWindow();
      return;
    }

    const dt = (now - this.motionPrevMs) / 1000;
    if (dt < MOTION_EVAL_MIN_S) return; // accumulate until the window is wide enough

    const imuPeak = this.peakHorizAccelMs2;
    const imuPeakDurationMs = this.peakDurationMs;
    // Lenient sanity check: reject GPS-only spikes the phone never physically felt.
    // The check applies only while the accelerometer is actually delivering samples;
    // when it is not — no such hardware, a registration that threw, or a subscription
    // that went quiet mid-trip — detection falls back to GPS alone rather than gating
    // on a peak that can no longer be measured (CAR-320, reversing the fail-closed
    // half of CAR-189). Failing closed suppressed *every* motion event for the rest of
    // the trip, and a trip with no events is indistinguishable from a flawless one:
    // the outage silently inflates the score. A GPS spike that fires unconfirmed is
    // the lesser error, because the trip carries accelInitFailed and accelCoverage
    // outward and is therefore visibly degraded rather than quietly perfect.
    const imuConfirms = !imuLive || imuPeak >= IMU_CONFIRM_MS2;

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
    this.clearWindow();
  }

  /** The per-window accumulators, and nothing that outlives a window. */
  private clearWindow(): void {
    this.peakHorizAccelMs2 = 0;
    this.peakHoriz2d = null;
    this.aboveConfirmSinceMs = null;
    this.peakStreakStartMs = null;
    this.peakDurationMs = 0;
    this.windowHorizSum = { a: 0, b: 0 };
    this.windowHorizCount = 0;
  }
}
