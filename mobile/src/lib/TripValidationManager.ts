/**
 * @file TripValidationManager.ts
 * @owner May (Mobile & Frontend UI Lead) — the trip lifecycle wiring.
 *        The rules it enforces are Dan's: Rule 3 delegates entirely to `FraudDetector.ts`.
 * @brief CARMA's implementation of the SDK's generic `TripValidator` interface.
 * A 1 Hz state machine that decides when a trip starts (Rule 1), when it ends (Rule 2),
 * and runs the fraud check before confirming it and again while it runs (Rule 3).
 * Rule 3 reports a journey once: after a verdict, classification stays suppressed until
 * movement genuinely stops, and a stale GPS sample suspends it entirely.
 */
import { ValidationState, TransportMode, ValidationSample, SuspiciousActivityEvaluation, TripValidator, SENSOR_STALE_MS } from '@/lib/driving-sdk/types';
import { FraudDetector, FRAUD_SCORE_THRESHOLD, FraudEvaluation } from '@/lib/FraudDetector';

// ─── Thresholds (Appendix E) ──────────────────────────────────────────────────
const SPEED_THRESHOLD_KMH    = 10;
const START_THRESHOLD_MS     = 30_000;   // Rule 1: 30s continuous > 10 km/h
const END_THRESHOLD_MS       = 180_000;  // Rule 2: 3 min continuous < 10 km/h
const TICK_INTERVAL_MS       = 1_000;    // 1Hz — downsample from SensorManager's 10Hz

export class TripValidationManager implements TripValidator {
  private state: ValidationState = ValidationState.IDLE;
  private continuousAboveThresholdMs = 0;
  private continuousBelowThresholdMs = 0;
  private latestSpeedKmh       = 0;
  private latestLateralAccelG  = 0;  // gravity-removed X-axis (g-units) — Rule 3 Signal B
  private latestGyroZ          = 0;  // yaw rate (rad/s) — Rule 3 Signal C
  private ticker: ReturnType<typeof setInterval> | null = null;
  private fraudDetector        = new FraudDetector();
  // Wall-clock receipt time of the last sample. GPS speed has no availability flag of
  // its own, so freshness is the only thing that separates a live reading from the last
  // one before the fix was lost (docs/fraud-detection.md §3.1).
  private lastSampleAtMs       = 0;
  // Set by any TRAIN verdict. While it is on, the vehicle has already been classified and
  // no new verdict may be reached — otherwise a rejection drops the state machine back to
  // IDLE while the train is still moving, the window refills, and the same journey files a
  // report every 30 s for its whole duration (§3.6). Cleared only by a genuine stop.
  private fraudClassificationSuppressed = false;

  // ─── Callbacks ─────────────────────────────────────────────────────────────
  public onTripConfirmed?: () => void;
  public onTripEnded?: () => void;
  public onStateChange?: (state: ValidationState) => void;
  // Fires when FraudDetector classifies non-car transport. Declared against the
  // driving-sdk's generic SuspiciousActivityEvaluation (TripValidator interface) —
  // the FraudEvaluation this class actually passes is a superset, so it satisfies it.
  public onFraudSuspected?: (evaluation: SuspiciousActivityEvaluation) => void;

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  public start(): void {
    if (this.ticker) return;
    this.reset();
    this.ticker = setInterval(() => this.tick(), TICK_INTERVAL_MS);
    console.log('[Validation] Started — waiting for movement');
  }

  public stop(): void {
    if (this.ticker) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
    this.reset();
    console.log('[Validation] Stopped and reset');
  }

  // ─── Speed + Sensor Feed ──────────────────────────────────────────────────
  // Called at up to 10Hz; tick() reads the latest values at 1Hz.
  public updateSample(sample: ValidationSample): void {
    // Receipt time, not sample.timestamp: the producer's clock says when the fix was
    // taken, and a stalled producer keeps re-sending an old one.
    this.lastSampleAtMs = Date.now();
    this.latestSpeedKmh = sample.speedKmh;
    if (sample.accel) {
      this.latestLateralAccelG = sample.accel.x;
    }
    if (sample.gyroYaw !== undefined) {
      this.latestGyroZ = sample.gyroYaw;
    }
  }

  // ─── Public Getters ────────────────────────────────────────────────────────

  public getState(): ValidationState {
    return this.state;
  }

  public isScoring(): boolean {
    return this.state === ValidationState.SCORING;
  }

  public getDebugSnapshot() {
    return {
      state: this.state,
      latestSpeedKmh: this.latestSpeedKmh,
      latestLateralAccelG: this.latestLateralAccelG,
      latestGyroZ: this.latestGyroZ,
      continuousAboveThresholdMs: this.continuousAboveThresholdMs,
      continuousBelowThresholdMs: this.continuousBelowThresholdMs,
      startThresholdMs: START_THRESHOLD_MS,
      endThresholdMs: END_THRESHOLD_MS,
      fraudEvaluation: this.fraudDetector.evaluate(),
    };
  }

  // ─── Internal: 1Hz Clock ──────────────────────────────────────────────────

  // §3.1: GPS speed unavailable suspends classification entirely — no verdict of any
  // kind. Rules 1 and 2 deliberately keep running on the last speed, as they always have;
  // narrowing them to fresh samples changes when a trip starts and ends, which is a wider
  // decision than the fraud path and is tracked separately.
  private isClassifying(): boolean {
    return !this.fraudClassificationSuppressed
      && (Date.now() - this.lastSampleAtMs) < SENSOR_STALE_MS;
  }

  private tick(): void {
    switch (this.state) {

      case ValidationState.IDLE:
        // §3.6: a verdict already stands, so no new one may be reached until movement
        // genuinely stops. Re-entering PRE_TRIP below is exactly what re-fires it.
        // "Genuinely stops" is Rule 2's stop, tested with Rule 2's own comparison — a
        // second definition of stopped in the same class is a defect waiting to happen.
        if (this.fraudClassificationSuppressed) {
          if (this.latestSpeedKmh < SPEED_THRESHOLD_KMH) {
            this.continuousBelowThresholdMs += TICK_INTERVAL_MS;
            if (this.continuousBelowThresholdMs >= END_THRESHOLD_MS) {
              this.fraudClassificationSuppressed = false;
              this.continuousBelowThresholdMs = 0;
              console.log('[Validation] Movement stopped — fraud classification re-armed');
            }
          } else {
            this.continuousBelowThresholdMs = 0;
          }
          break;
        }

        if (this.latestSpeedKmh > SPEED_THRESHOLD_KMH) {
          this.continuousAboveThresholdMs = TICK_INTERVAL_MS;
          // First fraud sample: collected at the IDLE→PRE_TRIP boundary so that
          // we have exactly MIN_SAMPLES_TO_EVALUATE samples when Rule 1 is checked.
          if (this.isClassifying()) {
            this.fraudDetector.addSample(this.latestSpeedKmh, this.latestLateralAccelG, this.latestGyroZ);
          }
          this.setState(ValidationState.PRE_TRIP);
        }
        break;

      case ValidationState.PRE_TRIP:
        if (this.latestSpeedKmh > SPEED_THRESHOLD_KMH) {
          this.continuousAboveThresholdMs += TICK_INTERVAL_MS;
          const classifying = this.isClassifying();
          if (classifying) {
            this.fraudDetector.addSample(this.latestSpeedKmh, this.latestLateralAccelG, this.latestGyroZ);
          }

          if (this.continuousAboveThresholdMs >= START_THRESHOLD_MS) {
            this.continuousAboveThresholdMs = START_THRESHOLD_MS; // cap — prevent overflow

            // Rule 3: evaluate fraud BEFORE confirming the trip.
            // At this point the window has exactly MIN_SAMPLES_TO_EVALUATE (30) samples.
            const fraud = classifying ? this.fraudDetector.evaluate() : null;
            if (fraud && this.shouldDecline(fraud)) {
              console.log(`[Validation] Rule 3 — ${fraud.mode} detected (score=${fraud.score.toFixed(2)}) — trip rejected`);
              this.continuousAboveThresholdMs = 0;
              this.fraudDetector.reset();
              // §3.6: one report per journey. Without this the vehicle is still above the
              // speed threshold on the very next tick and the whole 30 s detection re-arms.
              this.fraudClassificationSuppressed = true;
              this.continuousBelowThresholdMs = 0;
              this.setState(ValidationState.IDLE);
              this.onFraudSuspected?.(fraud);
              return;
            }

            // Rule 1 satisfied, no fraud ✓
            this.setState(ValidationState.SCORING);
            console.log('[Validation] Rule 1 passed — trip confirmed, scoring begins');
            this.onTripConfirmed?.();
          }
        } else {
          // Speed dropped before 30s — discard accumulated fraud data and reset
          this.continuousAboveThresholdMs = 0;
          this.fraudDetector.reset();
          this.setState(ValidationState.IDLE);
          console.log('[Validation] Pre-trip reset — speed dropped below threshold');
        }
        break;

      case ValidationState.SCORING:
        if (this.latestSpeedKmh < SPEED_THRESHOLD_KMH) {
          this.continuousBelowThresholdMs += TICK_INTERVAL_MS;
          if (this.continuousBelowThresholdMs >= END_THRESHOLD_MS) {
            // Rule 2 satisfied ✓
            this.setState(ValidationState.ENDED);
            console.log('[Validation] Rule 2 passed — 3 min below threshold, trip ended');
            this.onTripEnded?.();
          }
        } else {
          // Movement resumed — reset end-of-trip counter
          this.continuousBelowThresholdMs = 0;

          // Continue sliding-window fraud monitoring during scoring.
          // Fires onFraudSuspected at most once per session.
          if (this.isClassifying()) {
            this.fraudDetector.addSample(this.latestSpeedKmh, this.latestLateralAccelG, this.latestGyroZ);
            const fraud = this.fraudDetector.evaluate();
            if (this.shouldDecline(fraud)) {
              this.fraudClassificationSuppressed = true;
              console.log(`[Validation] Rule 3 (mid-trip) — ${fraud.mode} detected (score=${fraud.score.toFixed(2)})`);
              this.onFraudSuspected?.(fraud);
            }
          }
        }
        break;

      case ValidationState.ENDED:
        // Terminal state — stop the ticker to save battery
        if (this.ticker) {
          clearInterval(this.ticker);
          this.ticker = null;
        }
        break;
    }
  }

  // §3.5: the device may act unilaterally only on complete evidence — confidence 1.00
  // with mode TRAIN. The confidence term is redundant today (TRAIN already requires both
  // tri-state signals to be TRUE, which can only happen at full confidence) and is here
  // so the rule keeps its shape if a later signal set makes partial confidence reachable.
  // If it ever does, §3.5's other row — report at partial confidence, let the trip run —
  // needs a reporting channel that does not abort the session; onFraudSuspected does.
  private shouldDecline(fraud: FraudEvaluation): boolean {
    return fraud.isReady
      && fraud.score >= FRAUD_SCORE_THRESHOLD
      && fraud.confidence === 1
      && fraud.mode !== TransportMode.UNKNOWN;
  }

  private setState(next: ValidationState): void {
    this.state = next;
    this.onStateChange?.(next);
  }

  private reset(): void {
    this.state = ValidationState.IDLE;
    this.continuousAboveThresholdMs = 0;
    this.continuousBelowThresholdMs = 0;
    this.latestSpeedKmh      = 0;
    this.latestLateralAccelG = 0;
    this.latestGyroZ         = 0;
    this.lastSampleAtMs      = 0;
    this.fraudDetector.reset();
    this.fraudClassificationSuppressed = false;
  }
}
