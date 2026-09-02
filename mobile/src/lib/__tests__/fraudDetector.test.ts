/**
 * What the classifier may and may not conclude, now that its inputs are vehicle-frame
 * quantities rather than device axes.
 *
 * The suite this replaces asserted that signals 2 and 3 must stay silent: their inputs
 * were the phone's own X and Z, so a car with the phone upright in a vent clip produced a
 * fixture byte-identical to a train's, and neither signal could separate them (CAR-167).
 * With the frame resolved the inputs describe the vehicle, so both signals speak again —
 * and the cases below are what they have to get right.
 */
import { FraudDetector } from '@/lib/FraudDetector';
import { TransportMode } from '@/lib/transportMode';

/**
 * A car holding 80 km/h on a motorway, whatever the phone is clipped to. Almost no
 * lateral force — which is why signal 2 reads rail-like and the score clears 0.70 — but
 * the driver's micro-steering keeps yaw variance at 0.04, double the 0.02 gate.
 * Speed alternates ±0.1 around 80, so variance ≈ 0.01, far below the 8 km/h² gate.
 */
function motorwayCar(detector: FraudDetector, samples: number): void {
  for (let i = 0; i < samples; i++) {
    detector.addSample(80 + (i % 2 ? 0.1 : -0.1), 0.05, i % 2 ? 0.2 : -0.2);
  }
}

/** The same drive on rails: a fixed alignment, so the yaw of steering is absent too. */
function railJourney(detector: FraudDetector, samples: number): void {
  for (let i = 0; i < samples; i++) {
    detector.addSample(80 + (i % 2 ? 0.1 : -0.1), 0.01, 0.001);
  }
}

/** The frame could not be resolved — no GPS heading, or the phone moved mid-window. */
function unframed(detector: FraudDetector, samples: number): void {
  for (let i = 0; i < samples; i++) {
    detector.addSample(80 + (i % 2 ? 0.1 : -0.1), null, null);
  }
}

describe('FraudDetector — frame-dependent signals', () => {
  test('does not classify a motorway car as rail travel', () => {
    const detector = new FraudDetector();
    motorwayCar(detector, 30);

    const { mode, signals, score, confidence } = detector.evaluate();

    expect(mode).toBe(TransportMode.UNKNOWN);
    expect(signals.constantHighSpeed).toBe(true);
    expect(signals.noLateralForce).toBe(true);
    // The one signal that separates a cruising car from a train (§3.4).
    expect(signals.noHeadingChange).toBe(false);
    // 0.75 clears the 0.70 threshold — requiring signals 2 and 3 explicitly is what
    // stops the score alone from calling this rail travel.
    expect(score).toBeCloseTo(0.75);
    expect(confidence).toBeCloseTo(1.0);
  });

  test('classifies a rail profile as rail travel', () => {
    const detector = new FraudDetector();
    railJourney(detector, 30);

    const { mode, signals, score, confidence } = detector.evaluate();

    expect(mode).toBe(TransportMode.TRAIN);
    expect(signals).toEqual({
      constantHighSpeed: true,
      noLateralForce: true,
      noHeadingChange: true,
    });
    expect(score).toBeCloseTo(1.0);
    expect(confidence).toBeCloseTo(1.0);
  });

  test('reports UNKNOWN for the frame-dependent signals when the frame is unresolved', () => {
    const detector = new FraudDetector();
    unframed(detector, 30);

    const { mode, signals, score, confidence } = detector.evaluate();

    // An unresolvable frame is an absence of measurement, not a measurement of zero —
    // so neither signal votes, and TRAIN is unreachable by the shape of the rule.
    expect(signals.noLateralForce).toBeNull();
    expect(signals.noHeadingChange).toBeNull();
    expect(mode).toBe(TransportMode.UNKNOWN);
    expect(signals.constantHighSpeed).toBe(true);
    expect(score).toBeCloseTo(0.40);
    expect(confidence).toBeCloseTo(0.40);
  });

  test('a mostly unframed window does not let a handful of samples decide', () => {
    const detector = new FraudDetector();
    unframed(detector, 25);
    railJourney(detector, 5); // five framed samples out of thirty

    const { signals } = detector.evaluate();

    expect(signals.noLateralForce).toBeNull();
    expect(signals.noHeadingChange).toBeNull();
  });

  test('names each gate after the observation that set it', () => {
    const detector = new FraudDetector();
    // Urban driving: slow, varying, with real cornering forces and steering.
    for (let i = 0; i < 30; i++) detector.addSample(20 + (i % 5) * 8, 0.4, i % 2 ? 0.5 : -0.5);

    expect(detector.evaluate().signals).toEqual({
      constantHighSpeed: false,
      noLateralForce: false,
      noHeadingChange: false,
    });
  });

  test('reports no verdict below 30 samples, rather than a negative one', () => {
    const detector = new FraudDetector();
    railJourney(detector, 29);

    const evaluation = detector.evaluate();

    expect(evaluation.isReady).toBe(false);
    expect(evaluation.confidence).toBe(0);
    expect(evaluation.signals).toEqual({
      constantHighSpeed: null,
      noLateralForce: null,
      noHeadingChange: null,
    });
  });

  test('reset() empties the window, so a fresh 30 samples are needed again', () => {
    const detector = new FraudDetector();
    railJourney(detector, 20);
    detector.reset();

    railJourney(detector, 29);
    expect(detector.evaluate().isReady).toBe(false); // would be ready if the 20 survived

    railJourney(detector, 1);
    expect(detector.evaluate().isReady).toBe(true);
  });
});
