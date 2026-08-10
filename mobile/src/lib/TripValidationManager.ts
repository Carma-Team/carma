import { ValidationState, TransportMode, ValidationSample, SuspiciousActivityEvaluation, TripValidator } from '@/lib/driving-sdk/types';
import { FraudDetector, FRAUD_SCORE_THRESHOLD } from '@/lib/FraudDetector';

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
  private fraudSuspectedFired  = false;

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

  private tick(): void {
    switch (this.state) {

      case ValidationState.IDLE:
        if (this.latestSpeedKmh > SPEED_THRESHOLD_KMH) {
          this.continuousAboveThresholdMs = TICK_INTERVAL_MS;
          // First fraud sample: collected at the IDLE→PRE_TRIP boundary so that
          // we have exactly MIN_SAMPLES_TO_EVALUATE samples when Rule 1 is checked.
          this.fraudDetector.addSample(this.latestSpeedKmh, this.latestLateralAccelG, this.latestGyroZ);
          this.setState(ValidationState.PRE_TRIP);
        }
        break;

      case ValidationState.PRE_TRIP:
        if (this.latestSpeedKmh > SPEED_THRESHOLD_KMH) {
          this.continuousAboveThresholdMs += TICK_INTERVAL_MS;
          this.fraudDetector.addSample(this.latestSpeedKmh, this.latestLateralAccelG, this.latestGyroZ);

          if (this.continuousAboveThresholdMs >= START_THRESHOLD_MS) {
            this.continuousAboveThresholdMs = START_THRESHOLD_MS; // cap — prevent overflow

            // Rule 3: evaluate fraud BEFORE confirming the trip.
            // At this point the window has exactly MIN_SAMPLES_TO_EVALUATE (30) samples.
            const fraud = this.fraudDetector.evaluate();
            if (fraud.isReady && fraud.score >= FRAUD_SCORE_THRESHOLD && fraud.mode !== TransportMode.UNKNOWN) {
              console.log(`[Validation] Rule 3 — ${fraud.mode} detected (score=${fraud.score.toFixed(2)}) — trip rejected`);
              this.continuousAboveThresholdMs = 0;
              this.fraudDetector.reset();
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
          if (!this.fraudSuspectedFired) {
            this.fraudDetector.addSample(this.latestSpeedKmh, this.latestLateralAccelG, this.latestGyroZ);
            const fraud = this.fraudDetector.evaluate();
            if (fraud.isReady && fraud.score >= FRAUD_SCORE_THRESHOLD && fraud.mode !== TransportMode.UNKNOWN) {
              this.fraudSuspectedFired = true;
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
    this.fraudDetector.reset();
    this.fraudSuspectedFired = false;
  }
}
