/**
 * @file tapSignature.ts
 * @owner May Hajbi — driving-sdk maintainer
 * @brief The gyroscope half of phone-usage detection: angular-speed statistics over the
 * analysis window, and the paired-peak tap signature counted off the same stream.
 *
 * @description
 * Answers "how is this phone rotating", and nothing else. Since CAR-187 that is the
 * whole input to phone-usage detection: rotation variance says the phone was being
 * moved, the paired-peak count says a finger was working the screen. Which of the two
 * a given second counts as is PhoneUsageManager's decision, not this module's.
 *
 * Push-fed because the host already has the gyroscope subscribed (CAR-82). Not feeding
 * it is supported — the features stay empty and both counters stay at zero.
 */
import { VARIANCE_WINDOW_SIZE, computeVariance } from './variance';

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
export const ROTATION_VARIANCE_THRESHOLD = 0.5;

// Matches the 1 s analysis window at the expected 10 Hz gyro feed.
const GYRO_STALE_MS = 1000;

// ── Gyroscope tap signature (US11932257B2) ────────────────────────────────────
//
// The accelerometer tap proxy thresholds one number — total magnitude over 1.8 g,
// axis-blind — so a pothole crossing that magnitude reads exactly like a finger. The
// patent measures something else entirely: a *paired* rotational kick. A chassis jolt
// drives mostly the vertical accelerometer axis through the suspension, while a finger
// tap rotates the phone slightly about both in-plane axes at once, because the hand's
// grip resists it. Pairs, not force, is the distinction.
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

/** The rotational terms of {@link MotionFeatures}, over the current window. */
export interface RotationFeatures {
  rotationRateMean: number;
  rotationVariance: number;
  rotationSampleCount: number;
  gyroTapPairs: number;
}

export class TapSignatureDetector {
  private rotationWindow: number[] = [];
  private lastGyroMs = 0;
  // Edge detection: one physical kick spans several 10 Hz samples, and counting each of
  // them would turn one tap into a burst — a pair is registered on the sample that
  // *enters* the band, not on every sample inside it.
  private wasPairing = false;
  private lastPairAtMs = 0;
  // Completion times of taps inside the analysis window, trimmed by age on read so the
  // count describes the same second as the variance terms beside it.
  private tapPairTimes: number[] = [];

  public reset(): void {
    this.rotationWindow = [];
    this.lastGyroMs = 0;
    this.wasPairing = false;
    this.lastPairAtMs = 0;
    this.tapPairTimes = [];
  }

  /** One gyroscope sample (rad/s per axis), expected at the accelerometer's 10 Hz. */
  public push(x: number, y: number, z: number): void {
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

  public features(): RotationFeatures {
    // A gyro feed that has gone quiet since the last push (not just gapped mid-stream)
    // still holds those samples until the next push() call clears them — treat them as
    // if none had been pushed rather than wait for a push that may not come.
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
      rotationVariance: computeVariance(window),
      rotationSampleCount: n,
      gyroTapPairs: stale ? 0 : this.tapPairTimes.length,
    };
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
}
