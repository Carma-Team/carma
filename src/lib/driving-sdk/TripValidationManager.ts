import { ValidationState, TransportMode, ValidationSample } from '@/lib/driving-sdk/types';

// ─── Thresholds (Appendix E — נספח ה') ───────────────────────────────────────
const SPEED_THRESHOLD_KMH    = 10;
const START_THRESHOLD_MS     = 30_000;   // Rule 1: 30s continuous > 10 km/h
const END_THRESHOLD_MS       = 180_000;  // Rule 2: 3 min continuous < 10 km/h
const TICK_INTERVAL_MS       = 1_000;    // 1Hz — downsample from SensorManager's 10Hz

export class TripValidationManager {
  private state: ValidationState = ValidationState.IDLE;
  private continuousAboveThresholdMs = 0;
  private continuousBelowThresholdMs = 0;
  private latestSpeedKmh = 0;
  private ticker: ReturnType<typeof setInterval> | null = null;

  // ─── Callbacks ─────────────────────────────────────────────────────────────
  // Called when Rule 1 is satisfied — CarmaDrivingSDK should call startTrip() here
  public onTripConfirmed?: () => void;
  // Called when Rule 2 is satisfied — CarmaDrivingSDK should call stopTrip() here
  public onTripEnded?: () => void;
  // Called on every state transition — useful for UI and logging
  public onStateChange?: (state: ValidationState) => void;
  // Phase 2 hook — populated by FraudDetector when transport mode is classified
  public onFraudSuspected?: (confidence: number, mode: TransportMode) => void;

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  public start(): void {
    if (this.ticker) return; // guard against double-start
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

  // ─── Speed Feed (called by SensorManager or CarmaDrivingSDK.onUpdate) ─────
  // TripValidationManager consumes one value per tick at 1Hz.
  // The caller (SensorManager at 10Hz) just overwrites; we read the latest on each tick.
  public updateSample(sample: ValidationSample): void {
    this.latestSpeedKmh = sample.speedKmh;
    // Phase 2: pass accel/gyro to FraudDetector sliding window here
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
      continuousAboveThresholdMs: this.continuousAboveThresholdMs,
      continuousBelowThresholdMs: this.continuousBelowThresholdMs,
      startThresholdMs: START_THRESHOLD_MS,
      endThresholdMs: END_THRESHOLD_MS,
    };
  }

  // ─── Internal: 1Hz Clock ──────────────────────────────────────────────────

  private tick(): void {
    switch (this.state) {

      case ValidationState.IDLE:
        if (this.latestSpeedKmh > SPEED_THRESHOLD_KMH) {
          this.continuousAboveThresholdMs = TICK_INTERVAL_MS;
          this.setState(ValidationState.PRE_TRIP);
        }
        break;

      case ValidationState.PRE_TRIP:
        if (this.latestSpeedKmh > SPEED_THRESHOLD_KMH) {
          this.continuousAboveThresholdMs += TICK_INTERVAL_MS;
          if (this.continuousAboveThresholdMs >= START_THRESHOLD_MS) {
            // Rule 1 satisfied ✓
            this.continuousAboveThresholdMs = START_THRESHOLD_MS; // cap — prevent overflow
            this.setState(ValidationState.SCORING);
            console.log('[Validation] Rule 1 passed — trip confirmed, scoring begins');
            this.onTripConfirmed?.();
          }
        } else {
          // Speed dropped before 30s — reset to IDLE
          this.continuousAboveThresholdMs = 0;
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
    this.latestSpeedKmh = 0;
  }
}
