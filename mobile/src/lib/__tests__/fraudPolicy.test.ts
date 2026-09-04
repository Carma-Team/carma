import { FraudPolicy, FraudVerdict } from '@/lib/fraudPolicy';
import { FraudEvaluation, FRAUD_SCORE_THRESHOLD } from '@/lib/FraudDetector';
import { TransportMode } from '@/lib/transportMode';

function evaluation(overrides: Partial<FraudEvaluation> = {}): FraudEvaluation {
  return {
    score: FRAUD_SCORE_THRESHOLD,
    confidence: 1,
    isReady: true,
    mode: TransportMode.TRAIN,
    signals: { constantHighSpeed: true, noLateralForce: true, noHeadingChange: true },
    // Every sensor present, so the gate under test is the verdict and not a report
    // explaining its own unknowns. GPS is true unconditionally, as FraudDetector says.
    sensorAvailability: { gps: true, accelerometer: true, gyroscope: true },
    telemetry: { avgSpeedKmh: 90, maxLateralAccelG: 0.01, yawVariance: 0 },
    ...overrides,
  };
}

describe('FraudPolicy — the decline gate (§3.5)', () => {
  test('declines a ready TRAIN verdict at full confidence', () => {
    expect(new FraudPolicy().decide(evaluation())).toBe(FraudVerdict.DECLINE);
  });

  test.each([
    ['the window is not ready yet', { isReady: false }],
    ['the score is below the threshold', { score: FRAUD_SCORE_THRESHOLD - 0.01 }],
    ['the evidence is incomplete', { confidence: 0.5 }],
    ['the mode is unknown', { mode: TransportMode.UNKNOWN }],
  ])('does not decline when %s', (_label, overrides) => {
    expect(new FraudPolicy().decide(evaluation(overrides))).toBe(FraudVerdict.NONE);
  });

  test('has nothing to decide without an evaluation', () => {
    expect(new FraudPolicy().decide(null)).toBe(FraudVerdict.NONE);
  });
});

describe('FraudPolicy — the report-once latch (§3.6)', () => {
  test('a verdict suppresses every later one until it is re-armed', () => {
    const policy = new FraudPolicy();

    expect(policy.decide(evaluation())).toBe(FraudVerdict.DECLINE);
    expect(policy.isSuppressed()).toBe(true);
    expect(policy.decide(evaluation())).toBe(FraudVerdict.NONE);

    policy.rearm();

    expect(policy.isSuppressed()).toBe(false);
    expect(policy.decide(evaluation())).toBe(FraudVerdict.DECLINE);
  });

  test('an evaluation that does not decline leaves the latch alone', () => {
    const policy = new FraudPolicy();

    policy.decide(evaluation({ isReady: false }));

    expect(policy.isSuppressed()).toBe(false);
  });
});
