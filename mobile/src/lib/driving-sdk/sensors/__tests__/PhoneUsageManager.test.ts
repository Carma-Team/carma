import { DrivingEventType } from '@/lib/driving-sdk/types';

// ─── Mocks ────────────────────────────────────────────────────────────────────
// PhoneUsageManager reads AppState.currentState once in start(), then only ever
// reacts through the 'change' listener — so the mock only needs to expose that.
let appStateHandler: ((state: string) => void) | null = null;

jest.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: jest.fn((_event: string, handler: (state: string) => void) => {
      appStateHandler = handler;
      return { remove: jest.fn() };
    }),
  },
}));

let accelHandler: ((data: { x: number; y: number; z: number }) => void) | null = null;

jest.mock('expo-sensors', () => ({
  Accelerometer: {
    setUpdateInterval: jest.fn(),
    addListener: jest.fn((handler: (data: { x: number; y: number; z: number }) => void) => {
      accelHandler = handler;
      return { remove: jest.fn() };
    }),
  },
}));

import { PhoneUsageManager } from '@/lib/driving-sdk/sensors/PhoneUsageManager';

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Steady magnitude (mounted phone — road vibration only) => ~zero variance.
const MOUNTED_SAMPLES = new Array(10).fill(1.0);
// Alternating high/low magnitude (hand-held micro-movements) => variance well above
// HANDHELD_VARIANCE_THRESHOLD (0.025 g²).
const HANDHELD_SAMPLES = [1.0, 1.6, 0.6, 1.7, 0.5, 1.6, 0.6, 1.7, 0.5, 1.6];

function feedAccel(magnitudes: number[]) {
  magnitudes.forEach((mag) => accelHandler?.({ x: mag, y: 0, z: 0 }));
}

describe('PhoneUsageManager', () => {
  let onEvent: jest.Mock;
  let onInteractionData: jest.Mock;
  let manager: PhoneUsageManager;

  beforeEach(() => {
    jest.useFakeTimers();
    appStateHandler = null;
    accelHandler = null;
    onEvent = jest.fn();
    onInteractionData = jest.fn();
    manager = new PhoneUsageManager(onEvent, onInteractionData);
    manager.start();
  });

  afterEach(() => {
    manager.stop();
    jest.useRealTimers();
  });

  it('does not fire PHONE_USAGE on a bare background/inactive transition alone (Siri, calls, Control Center)', () => {
    // No accel samples yet — variance defaults to 0, well under the hand-held threshold.
    appStateHandler?.('inactive');
    jest.advanceTimersByTime(1000);

    expect(onEvent).not.toHaveBeenCalled();
  });

  it('does not fire PHONE_USAGE while backgrounded with low IMU variance (phone mounted)', () => {
    appStateHandler?.('background');
    feedAccel(MOUNTED_SAMPLES);
    jest.advanceTimersByTime(1000);

    expect(onEvent).not.toHaveBeenCalled();
  });

  it('fires PHONE_USAGE once when backgrounded IMU variance confirms hand-held use', () => {
    appStateHandler?.('background');
    feedAccel(HANDHELD_SAMPLES);
    jest.advanceTimersByTime(1000);

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: DrivingEventType.PHONE_USAGE }),
    );

    // Still hand-held on the next tick — must not re-fire.
    feedAccel(HANDHELD_SAMPLES);
    jest.advanceTimersByTime(1000);
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it('fires PHONE_USAGE again after the phone is set back down and picked up a second time', () => {
    appStateHandler?.('background');

    feedAccel(HANDHELD_SAMPLES);
    jest.advanceTimersByTime(1000);
    expect(onEvent).toHaveBeenCalledTimes(1);

    feedAccel(MOUNTED_SAMPLES); // set back down — variance drops
    jest.advanceTimersByTime(1000);
    expect(onEvent).toHaveBeenCalledTimes(1);

    feedAccel(HANDHELD_SAMPLES); // picked up again
    jest.advanceTimersByTime(1000);
    expect(onEvent).toHaveBeenCalledTimes(2);
  });

  it('increments touchEpochs on a glass-tap transient regardless of foreground/background', () => {
    feedAccel([2.5]); // magnitude 2.5g > GLASS_TAP_MAGNITUDE_THRESHOLD (1.8g)

    expect(onInteractionData).toHaveBeenCalledWith(
      expect.objectContaining({ touchEpochs: 1 }),
    );
  });

  // ─── Rotational features (CAR-82) ──────────────────────────────────────────
  // The gyroscope stream is pushed in from outside, so a host that never calls
  // pushGyroSample must still work — the features just stay empty.
  describe('motion features', () => {
    it('reports empty rotational features when no gyroscope samples arrive', () => {
      feedAccel(HANDHELD_SAMPLES);
      const features = manager.getMotionFeatures();

      expect(features.rotationSampleCount).toBe(0);
      expect(features.rotationRateMean).toBe(0);
      expect(features.rotationVariance).toBe(0);
      // The acceleration side is unaffected by the gyroscope being absent.
      expect(features.accelVariance).toBeGreaterThan(0.025);
    });

    it('derives mean and variance of angular speed from pushed samples', () => {
      manager.pushGyroSample(0.1, 0, 0);
      manager.pushGyroSample(0.3, 0, 0);

      const features = manager.getMotionFeatures();
      expect(features.rotationSampleCount).toBe(2);
      expect(features.rotationRateMean).toBeCloseTo(0.2, 6);
      expect(features.rotationVariance).toBeCloseTo(0.01, 6);
    });

    it('takes angular speed as the magnitude across all three axes', () => {
      manager.pushGyroSample(3, 4, 0); // |(3,4,0)| = 5

      expect(manager.getMotionFeatures().rotationRateMean).toBeCloseTo(5, 6);
    });

    it('keeps the rotation window to the same 1-second span as the accelerometer window', () => {
      manager.pushGyroSample(5, 0, 0);
      manager.pushGyroSample(5, 0, 0);
      for (let i = 0; i < 10; i++) manager.pushGyroSample(0, 0, 0);

      const features = manager.getMotionFeatures();
      expect(features.rotationSampleCount).toBe(10); // capped, oldest dropped
      expect(features.rotationRateMean).toBe(0);     // the two 5 rad/s samples aged out
    });

    it('ignores gyroscope samples pushed while stopped', () => {
      manager.stop();
      manager.pushGyroSample(1, 0, 0);

      expect(manager.getMotionFeatures().rotationSampleCount).toBe(0);
    });

    it('does not let rotation influence the hand-held decision', () => {
      // Plumbing only (CAR-82): heavy rotation with mounted-phone acceleration must
      // still read as not-handheld. Changing that is CAR-46, and needs CAR-31 data.
      appStateHandler?.('background');
      feedAccel(MOUNTED_SAMPLES);
      for (let i = 0; i < 10; i++) manager.pushGyroSample(i % 2 === 0 ? 4 : 0, 0, 0);
      jest.advanceTimersByTime(1000);

      expect(onEvent).not.toHaveBeenCalled();
      expect(onInteractionData).not.toHaveBeenCalled();
      expect(manager.getMotionFeatures().rotationVariance).toBeGreaterThan(0);
    });
  });
});
