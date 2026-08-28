import { DefaultTripValidator } from '@/lib/driving-sdk/DefaultTripValidator';
import type { ValidationSample } from '@/lib/driving-sdk/types';

// No mocks. The default validator touches no platform API, no timer and no sensor,
// so everything it does is observable through the three callbacks alone.

const sampleAt = (speedKmh: number): ValidationSample => ({ speedKmh, timestamp: 1_700_000_000_000 });

describe('DefaultTripValidator', () => {
  let validator: DefaultTripValidator;
  let onTripConfirmed: jest.Mock;
  let onTripEnded: jest.Mock;
  let onFraudSuspected: jest.Mock;

  beforeEach(() => {
    validator = new DefaultTripValidator();
    onTripConfirmed = jest.fn();
    onTripEnded = jest.fn();
    onFraudSuspected = jest.fn();
    validator.onTripConfirmed = onTripConfirmed;
    validator.onTripEnded = onTripEnded;
    validator.onFraudSuspected = onFraudSuspected;
  });

  it('confirms the trip synchronously inside start(), so a host that supplies no validator never waits', () => {
    validator.start();

    expect(onTripConfirmed).toHaveBeenCalledTimes(1);
  });

  it('confirms once per start(), so back-to-back trips each get their own confirmation', () => {
    validator.start();
    validator.stop();
    validator.start();

    expect(onTripConfirmed).toHaveBeenCalledTimes(2);
  });

  it('never ends a trip on its own: stop() tears nothing down and fires nothing', () => {
    validator.start();
    validator.stop();

    expect(onTripEnded).not.toHaveBeenCalled();
  });

  it('ignores every sample, at any speed, however many arrive', () => {
    validator.start();
    onTripConfirmed.mockClear();

    for (const speedKmh of [0, 12, 55, 130]) validator.updateSample(sampleAt(speedKmh));

    expect(onTripConfirmed).not.toHaveBeenCalled();
    expect(onTripEnded).not.toHaveBeenCalled();
  });

  it('never evaluates suspicion: a host that wants it implements TripValidator itself', () => {
    validator.start();
    validator.updateSample(sampleAt(90));
    validator.stop();

    expect(onFraudSuspected).not.toHaveBeenCalled();
  });

  it('runs with no callback attached, so the SDK may construct it before wiring listeners', () => {
    const bare = new DefaultTripValidator();

    expect(() => {
      bare.start();
      bare.updateSample(sampleAt(50));
      bare.stop();
    }).not.toThrow();
  });
});
