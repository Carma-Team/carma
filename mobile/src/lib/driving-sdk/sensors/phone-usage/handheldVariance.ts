/**
 * @file handheldVariance.ts
 * @owner May Hajbi — driving-sdk maintainer
 * @brief The accelerometer half of phone-usage detection: variance of acceleration
 * magnitude, and the glass-tap transient proxy counted off the same stream.
 *
 * @description
 * Answers "how much is this phone being moved about", and nothing else. Whether that
 * means hand-held is not decided here — a phone loose on a seat also bounces, and only
 * the rotational terms separate the two (CAR-174). PhoneUsageManager owns that decision
 * and reads this alongside the gyroscope half.
 *
 * Push-fed: the host already has the accelerometer subscribed for motion-event
 * detection, so nothing here subscribes to anything (CAR-325).
 */
import { VARIANCE_WINDOW_SIZE, computeVariance } from './variance';

// HANDHELD_VARIANCE_THRESHOLD (g²):
//   Phone on a vehicle mount → variance ~0.002–0.010 g² (road vibration only).
//   Phone hand-held          → variance ~0.030–0.150 g² (micro hand-movements).
//   0.025 g² gives a comfortable separation margin.
//   Requires empirical calibration before Sprint+1 — see RFC-001 §4.3.
export const HANDHELD_VARIANCE_THRESHOLD = 0.025;

// GLASS_TAP_MAGNITUDE_THRESHOLD (g):
//   A finger tap on glass/screen produces a sharp transient of 1.8–3.0 g total
//   magnitude. Road bumps rarely reach 1.8 g with the same sharp onset profile.
//   The 1 500 ms inter-epoch cooldown prevents one physical tap from registering
//   multiple times across the 10 Hz sample stream.
const GLASS_TAP_MAGNITUDE_THRESHOLD = 1.8;
const EPOCH_COOLDOWN_MS = 1500;

export class HandheldVarianceDetector {
  private magnitudeWindow: number[] = [];
  private touchEpochsTotal = 0;
  private touchEpochsThisTick = 0;
  private lastEpochMs = 0;

  public reset(): void {
    this.magnitudeWindow = [];
    this.touchEpochsTotal = 0;
    this.touchEpochsThisTick = 0;
    this.lastEpochMs = 0;
  }

  /** One accelerometer sample, gravity still in it — the tap threshold is set against the ~1 g rest. */
  public push(x: number, y: number, z: number): void {
    const mag = Math.sqrt(x * x + y * y + z * z);

    this.magnitudeWindow.push(mag);
    if (this.magnitudeWindow.length > VARIANCE_WINDOW_SIZE) this.magnitudeWindow.shift();

    // Glass-tap proxy: sharp transient well above the resting ~1 g baseline.
    const now = Date.now();
    if (mag > GLASS_TAP_MAGNITUDE_THRESHOLD && now - this.lastEpochMs > EPOCH_COOLDOWN_MS) {
      this.touchEpochsTotal++;
      this.touchEpochsThisTick++;
      this.lastEpochMs = now;
    }
  }

  /** Variance of total acceleration magnitude (g²) over the current window. */
  public get accelVariance(): number {
    return computeVariance(this.magnitudeWindow);
  }

  /** Running total since the last reset — what a snapshot of the whole trip reports. */
  public get touchEpochs(): number {
    return this.touchEpochsTotal;
  }

  /** Epochs since the previous call, and zero from here — emissions are deltas (CAR-175). */
  public takeTickEpochs(): number {
    const n = this.touchEpochsThisTick;
    this.touchEpochsThisTick = 0;
    return n;
  }
}
