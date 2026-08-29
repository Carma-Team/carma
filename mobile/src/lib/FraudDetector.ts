/**
 * @file FraudDetector.ts
 * @owner Dan (CPO) — fraud & transport-mode detection
 * @brief Sliding-window classifier that decides whether a session is private car travel.
 * Buffers 60 samples of speed, lateral acceleration and yaw rate, and evaluates three
 * weighted signals. Each signal is TRUE, FALSE or UNKNOWN; a verdict carries both a
 * score (the weight of the evidence that fired) and a confidence (the weight of the
 * evidence that could be evaluated at all). See docs/fraud-detection.md §3.3–§3.4.
 */
import { TransportMode } from '@/lib/driving-sdk/types';

// ─── Thresholds (docs/fraud-detection.md §3.3) ───────────────────────────────
const WINDOW_SIZE = 60;
const MIN_SAMPLES_TO_EVALUATE = 30; // enough to evaluate at Rule 1 boundary (30s)

// Signal 1: trains maintain constant speed on a straight track
const SPEED_VARIANCE_THRESHOLD = 8;  // km/h²
const MIN_AVG_SPEED_KMH        = 60; // must be fast enough to rule out city driving

// Signal 2: rails prevent sway; a road vehicle always corners. Vehicle-frame lateral
// force, so it means the same thing whatever orientation the phone is sitting in.
const MAX_LATERAL_ACCEL_G = 0.12;
// Signal 3: track geometry is fixed; a driver micro-corrects continuously. Variance of
// yaw rate about gravity — not about the device's Z axis (§3.2 step 4).
const MAX_YAW_VARIANCE = 0.02; // rad²/s²

// Samples with a resolvable vehicle frame that a signal needs before it says anything.
// Below this the frame was unavailable for most of the window and the answer is UNKNOWN,
// which is not the same claim as "no lateral force was felt".
const MIN_FRAMED_SAMPLES = 30;

// Weights (must sum to 1.0). Score and confidence are both sums over this table, so a
// signal cannot be counted towards one and forgotten in the other.
const WEIGHTS: Record<keyof FraudSignals, number> = {
  constantHighSpeed: 0.40,
  noLateralForce:    0.35,
  noHeadingChange:   0.25,
};

export const FRAUD_SCORE_THRESHOLD = 0.70;

// ─── Circular Buffer ─────────────────────────────────────────────────────────
// O(1) insert, fixed memory (4 bytes × WINDOW_SIZE per buffer, ~720 bytes total)
class CircularBuffer {
  private buf: Float32Array;
  private writeIdx = 0;
  private _size = 0;

  constructor(capacity: number) {
    this.buf = new Float32Array(capacity);
  }

  push(value: number): void {
    this.buf[this.writeIdx] = value;
    this.writeIdx = (this.writeIdx + 1) % this.buf.length;
    if (this._size < this.buf.length) this._size++;
  }

  // Returns values in insertion order (oldest first)
  get values(): number[] {
    const result: number[] = new Array(this._size);
    const start = this._size < this.buf.length ? 0 : this.writeIdx;
    for (let i = 0; i < this._size; i++) {
      result[i] = this.buf[(start + i) % this.buf.length];
    }
    return result;
  }

  get size(): number { return this._size; }

  reset(): void {
    this.writeIdx = 0;
    this._size = 0;
  }
}

// ─── FraudEvaluation ─────────────────────────────────────────────────────────

/** The three rule gates, named after what the sensor showed rather than by
 *  letter — these values leave the device and are read from a table row later,
 *  where "a" and "b" mean nothing. Order matches Signals 1/2/3 above.
 *
 *  `null` is UNKNOWN: the signal could not be evaluated, which is a different
 *  claim from `false`. It matches the nullable field on the wire
 *  (server/app/schemas/fraud.py) and never satisfies a TRUE requirement. */
export type FraudSignals = {
  constantHighSpeed: boolean | null;
  noLateralForce: boolean | null;
  noHeadingChange: boolean | null;
}

export interface FraudEvaluation {
  score: number;
  /** Weight of the evidence that could be evaluated at all (§3.4). Below 1.00 the
   *  device may report a verdict but not decline a trip on it. */
  confidence: number;
  isReady: boolean;
  mode: TransportMode;
  signals: FraudSignals;
  // Raw computed values — passed through to the API payload for Sean's analytics
  telemetry: {
    avgSpeedKmh: number;
    // Vehicle-frame peak, in g. 0 when no sample in the window could be framed —
    // read `signals.noLateralForce === null` to tell that apart from a real 0.
    maxLateralAccelG: number;
    yawVariance: number;        // rad²/s², about gravity
  };
}

// ─── FraudDetector ───────────────────────────────────────────────────────────

export class FraudDetector {
  private speedBuffer  = new CircularBuffer(WINDOW_SIZE);
  private accelBuffer  = new CircularBuffer(WINDOW_SIZE);
  private gyroBuffer   = new CircularBuffer(WINDOW_SIZE);

  /**
   * @param speedKmh      GPS ground speed. Frame-free.
   * @param lateralAccelG Lateral force **in the vehicle's frame**, in g, signed positive
   *                      to the left of travel. `null` when the SDK could not resolve the
   *                      frame — stored as NaN and excluded from the window, so Signal 2
   *                      reads UNKNOWN rather than "no force".
   * @param yawRateRadS   Angular rate **about gravity**, in rad/s, signed. `null` under
   *                      the same conditions, with the same meaning for Signal 3.
   */
  addSample(speedKmh: number, lateralAccelG: number | null, yawRateRadS: number | null): void {
    this.speedBuffer.push(speedKmh);
    // NaN is the in-band "not measured" marker: the buffers are Float32Array for the
    // fixed memory, and every comparison against NaN is false, so an unresolved sample
    // cannot accidentally satisfy a threshold. `framed` below is what filters them out.
    this.accelBuffer.push(lateralAccelG === null ? NaN : Math.abs(lateralAccelG));
    this.gyroBuffer.push(yawRateRadS === null ? NaN : yawRateRadS);
  }

  evaluate(): FraudEvaluation {
    if (this.speedBuffer.size < MIN_SAMPLES_TO_EVALUATE) {
      // No verdict, not a negative one (§3.4) — a window this short has not shown us
      // a car either.
      return {
        score: 0, confidence: 0, isReady: false, mode: TransportMode.UNKNOWN,
        signals: { constantHighSpeed: null, noLateralForce: null, noHeadingChange: null },
        telemetry: { avgSpeedKmh: 0, maxLateralAccelG: 0, yawVariance: 0 },
      };
    }

    const speeds = this.speedBuffer.values;
    // Samples the SDK could place in the vehicle frame. A phone that moved mid-window,
    // or a stretch with no GPS heading, leaves gaps here — and a gappy window is a
    // window that has not shown us anything, which is UNKNOWN and not FALSE.
    const accels = this.accelBuffer.values.filter((v) => !Number.isNaN(v));
    const gyros  = this.gyroBuffer.values.filter((v) => !Number.isNaN(v));

    const avgSpeedKmh      = speeds.reduce((s, v) => s + v, 0) / speeds.length;
    const speedVariance    = this.calcVariance(speeds);
    const maxLateralAccelG = accels.length > 0 ? Math.max(...accels) : 0;
    const yawVariance      = this.calcVariance(gyros);

    const signals: FraudSignals = {
      // Signal 1: constant speed, fast enough to rule out city stop-go
      constantHighSpeed: speedVariance < SPEED_VARIANCE_THRESHOLD && avgSpeedKmh > MIN_AVG_SPEED_KMH,
      // Signals 2 and 3 read vehicle-frame quantities now, so they measure the vehicle
      // rather than the phone's mounting. They were forced to UNKNOWN while the inputs
      // were device axes: a phone upright in a vent clip turns a car's cornering force
      // off X and its yaw off Z at the same time, which is one mounting error reading as
      // two votes for rail (CAR-167). They still go UNKNOWN when the frame is unresolved.
      noLateralForce: accels.length >= MIN_FRAMED_SAMPLES
        ? maxLateralAccelG < MAX_LATERAL_ACCEL_G
        : null,
      noHeadingChange: gyros.length >= MIN_FRAMED_SAMPLES
        ? yawVariance < MAX_YAW_VARIANCE
        : null,
    };

    const score      = sumWeights(signals, (value) => value === true);
    const confidence = sumWeights(signals, (value) => value !== null);

    // UNKNOWN cannot satisfy a TRUE requirement, so TRAIN stays unreachable by the shape
    // of the rule rather than by a flag a later edit could drop (§3.4).
    const mode = score >= FRAUD_SCORE_THRESHOLD
      && signals.noLateralForce === true
      && signals.noHeadingChange === true
      ? TransportMode.TRAIN : TransportMode.UNKNOWN;

    return {
      score, confidence, isReady: true, mode, signals,
      telemetry: { avgSpeedKmh, maxLateralAccelG, yawVariance },
    };
  }

  reset(): void {
    this.speedBuffer.reset();
    this.accelBuffer.reset();
    this.gyroBuffer.reset();
  }

  // Var(X) = E[X²] − E[X]²  (single-pass, numerically stable for reasonable float ranges)
  private calcVariance(values: number[]): number {
    if (values.length < 2) return 0;
    let sum = 0;
    let sumSq = 0;
    for (const v of values) {
      sum   += v;
      sumSq += v * v;
    }
    const mean = sum / values.length;
    return (sumSq / values.length) - mean * mean;
  }
}

function sumWeights(signals: FraudSignals, counts: (value: boolean | null) => boolean): number {
  return (Object.keys(WEIGHTS) as (keyof FraudSignals)[])
    .reduce((total, name) => (counts(signals[name]) ? total + WEIGHTS[name] : total), 0);
}
