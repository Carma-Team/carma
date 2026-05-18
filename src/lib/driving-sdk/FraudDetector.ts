import { TransportMode } from '@/lib/driving-sdk/types';

// ─── Thresholds (Appendix E — נספח ה', Rule 3) ───────────────────────────────
const WINDOW_SIZE = 60;
const MIN_SAMPLES_TO_EVALUATE = 30; // enough to evaluate at Rule 1 boundary (30s)

// Signal A: trains maintain constant speed on a straight track
const SPEED_VARIANCE_THRESHOLD = 8;  // km/h²
const MIN_AVG_SPEED_KMH        = 60; // must be fast enough to rule out city driving

// Signal B: rails absorb lateral jolts — car curves/lanes produce >> 0.12g
const LATERAL_ACCEL_MAX_G = 0.12; // g-units (gravity-removed X-axis)

// Signal C: train heading barely changes over a minute
const YAW_VARIANCE_THRESHOLD = 0.02; // rad²/s²

// Weights (must sum to 1.0)
const WEIGHT_A = 0.40;
const WEIGHT_B = 0.35;
const WEIGHT_C = 0.25;

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

export interface FraudEvaluation {
  score: number;
  isReady: boolean;
  mode: TransportMode;
  signals: { a: boolean; b: boolean; c: boolean };
}

// ─── FraudDetector ───────────────────────────────────────────────────────────

export class FraudDetector {
  private speedBuffer  = new CircularBuffer(WINDOW_SIZE);
  private accelBuffer  = new CircularBuffer(WINDOW_SIZE);
  private gyroBuffer   = new CircularBuffer(WINDOW_SIZE);

  addSample(speedKmh: number, lateralAccelG: number, gyroZ: number): void {
    this.speedBuffer.push(speedKmh);
    this.accelBuffer.push(Math.abs(lateralAccelG)); // peak magnitude is what matters
    this.gyroBuffer.push(gyroZ);
  }

  evaluate(): FraudEvaluation {
    if (this.speedBuffer.size < MIN_SAMPLES_TO_EVALUATE) {
      return { score: 0, isReady: false, mode: TransportMode.UNKNOWN, signals: { a: false, b: false, c: false } };
    }

    const speeds = this.speedBuffer.values;
    const accels = this.accelBuffer.values;
    const gyros  = this.gyroBuffer.values;

    const avgSpeed       = speeds.reduce((s, v) => s + v, 0) / speeds.length;
    const speedVariance  = this.calcVariance(speeds);
    const maxLateralAccel = Math.max(...accels);
    const yawVariance    = this.calcVariance(gyros);

    // Signal A: low speed variance (constant speed) AND high-speed (not urban stop-go)
    const signalA = speedVariance < SPEED_VARIANCE_THRESHOLD && avgSpeed > MIN_AVG_SPEED_KMH;
    // Signal B: near-zero lateral force (rails prevent sway)
    const signalB = maxLateralAccel < LATERAL_ACCEL_MAX_G;
    // Signal C: minimal heading change (straight-line travel)
    const signalC = yawVariance < YAW_VARIANCE_THRESHOLD;

    const score = (signalA ? WEIGHT_A : 0) + (signalB ? WEIGHT_B : 0) + (signalC ? WEIGHT_C : 0);
    const mode  = score >= FRAUD_SCORE_THRESHOLD ? TransportMode.TRAIN : TransportMode.UNKNOWN;

    return { score, isReady: true, mode, signals: { a: signalA, b: signalB, c: signalC } };
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
