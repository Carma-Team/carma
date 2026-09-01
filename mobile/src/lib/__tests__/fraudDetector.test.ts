/**
 * What the classifier may and may not conclude from device-frame axes.
 *
 * The fixture below is a car at a steady 80 km/h with the phone upright in a vent clip:
 * the car's cornering force lands off the phone's X axis and its yaw off the phone's Z,
 * so both read near zero. It is byte-identical to the train fixture this suite used to
 * assert on, which is the finding — from these two axes the two are indistinguishable,
 * so neither signal may speak (CAR-167).
 */
import { FraudDetector } from '@/lib/FraudDetector';
import { TransportMode } from '@/lib/transportMode';

// Speed alternates ±0.1 around 80 → variance ≈ 0.01, far below the 8 km/h² gate.
function ventClippedCar(detector: FraudDetector, samples: number): void {
  for (let i = 0; i < samples; i++) {
    detector.addSample(80 + (i % 2 ? 0.1 : -0.1), 0.01, 0.001);
  }
}

describe('FraudDetector — frame-dependent signals', () => {
  test('does not classify a vent-clipped car as rail travel', () => {
    const detector = new FraudDetector();
    ventClippedCar(detector, 30);

    const { mode, signals, score, confidence } = detector.evaluate();

    expect(mode).toBe(TransportMode.UNKNOWN);
    expect(signals.noLateralForce).toBeNull();
    expect(signals.noHeadingChange).toBeNull();
    // Only the frame-free signal is evidence, so it is all the confidence there is.
    expect(signals.constantHighSpeed).toBe(true);
    expect(score).toBeCloseTo(0.40);
    expect(confidence).toBeCloseTo(0.40);
  });

  test('names each gate after the observation that set it', () => {
    const detector = new FraudDetector();
    // Urban driving: slow, varying, with real cornering forces and steering.
    for (let i = 0; i < 30; i++) detector.addSample(20 + (i % 5) * 8, 0.4, i % 2 ? 0.5 : -0.5);

    expect(detector.evaluate().signals).toEqual({
      constantHighSpeed: false,
      noLateralForce: null,
      noHeadingChange: null,
    });
  });

  test('reports no verdict below 30 samples, rather than a negative one', () => {
    const detector = new FraudDetector();
    ventClippedCar(detector, 29);

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
    ventClippedCar(detector, 20);
    detector.reset();

    ventClippedCar(detector, 29);
    expect(detector.evaluate().isReady).toBe(false); // would be ready if the 20 survived

    ventClippedCar(detector, 1);
    expect(detector.evaluate().isReady).toBe(true);
  });
});
