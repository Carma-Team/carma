/**
 * @file fraudPolicy.ts
 * @owner Dan (anti-fraud)
 * @brief The Rule 3 decision, and nothing else: whether an evaluation is enough for the
 * device to decline a journey on its own, and how long a verdict keeps further
 * classification suppressed.
 *
 * `TripValidationManager` owns the timing — Rule 1, Rule 2, the ticker and the
 * callbacks — and asks this module for the verdict. Every future Rule 3 change lands
 * here (docs/fraud-detection.md §3.5-§3.6).
 */
import { TransportMode } from '@/lib/transportMode';
import { FRAUD_SCORE_THRESHOLD, FraudEvaluation } from '@/lib/FraudDetector';

export enum FraudVerdict {
  /** Nothing to act on — carry on with the trip. */
  NONE = 'NONE',
  /** Non-car transport on complete evidence: abort the trip and report it once. */
  DECLINE = 'DECLINE',
}

/**
 * Holds the report-once latch for one validator instance. In memory only, and bounded
 * by movement dwell rather than by a clock (CAR-247 decision 1): a suppression
 * timestamp that survived an app restart could kill a legitimate car trip, which the
 * fail-toward-acceptance principle does not allow.
 */
export class FraudPolicy {
  private suppressed = false;

  /** True while a verdict stands. No new classification may be reached until re-armed. */
  public isSuppressed(): boolean {
    return this.suppressed;
  }

  /**
   * The verdict for one evaluation, latching suppression when it declines.
   *
   * §3.5: the device may act unilaterally only on complete evidence — confidence 1.00
   * with a known mode. The confidence term is redundant today (TRAIN already requires
   * both tri-state signals to be TRUE, which can only happen at full confidence) and is
   * here so the rule keeps its shape if a later signal set makes partial confidence
   * reachable. If it ever does, §3.5's other row — report at partial confidence, let the
   * trip run — needs a reporting channel that does not abort the session.
   */
  public decide(fraud: FraudEvaluation | null): FraudVerdict {
    if (this.suppressed || !fraud) return FraudVerdict.NONE;

    const decline =
      fraud.isReady &&
      fraud.score >= FRAUD_SCORE_THRESHOLD &&
      fraud.confidence === 1 &&
      fraud.mode !== TransportMode.UNKNOWN;

    if (!decline) return FraudVerdict.NONE;

    // §3.6: one report per journey. Without the latch the vehicle is still above the
    // speed threshold on the very next tick and the whole 30 s detection re-arms, so a
    // train files a report every 30 s for the length of the journey.
    this.suppressed = true;
    return FraudVerdict.DECLINE;
  }

  /**
   * Lifts the suppression. The caller decides when movement has genuinely stopped —
   * that is Rule 2's stop, measured with Rule 2's own comparison, and a second
   * definition of stopped would be a defect waiting to happen.
   */
  public rearm(): void {
    this.suppressed = false;
  }
}
