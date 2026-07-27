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
});
