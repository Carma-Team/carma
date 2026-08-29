import { DrivingEventType } from '@/lib/driving-sdk/types';

// ─── Mocks ────────────────────────────────────────────────────────────────────
// Only the accelerometer is subscribed here. Gyroscope samples are pushed in by the
// host (CAR-82) and AppState is not consulted at all (CAR-45), so neither needs a mock.
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

  it('does not fire PHONE_USAGE without IMU evidence (Siri, calls, Control Center)', () => {
    // No accel samples yet — variance defaults to 0, well under the hand-held threshold.
    jest.advanceTimersByTime(1000);

    expect(onEvent).not.toHaveBeenCalled();
  });

  it('does not fire PHONE_USAGE on low IMU variance (phone mounted)', () => {
    feedAccel(MOUNTED_SAMPLES);
    jest.advanceTimersByTime(1000);

    expect(onEvent).not.toHaveBeenCalled();
  });

  it('fires PHONE_USAGE once when IMU variance confirms hand-held use', () => {
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

  it('increments touchEpochs on a glass-tap transient', () => {
    feedAccel([2.5]); // magnitude 2.5g > GLASS_TAP_MAGNITUDE_THRESHOLD (1.8g)
    jest.advanceTimersByTime(1000); // emission happens on the 1s tick, not on the tap itself

    expect(onInteractionData).toHaveBeenCalledWith(
      expect.objectContaining({ touchEpochs: 1 }),
    );
  });

  // ─── Hand-held time is measured regardless of app state (CAR-45) ───────────
  // The manager used to run its tick only between an AppState background transition
  // and the return to foreground. These tests never touch AppState — that is the point.
  describe('hand-held accounting', () => {
    it('counts hand-held seconds with no app-state transition at all', () => {
      feedAccel(HANDHELD_SAMPLES);
      jest.advanceTimersByTime(3000);

      expect(manager.getSnapshot().screenInteractionSeconds).toBe(3);
      expect(onEvent).toHaveBeenCalledTimes(1); // one stretch, one event
    });

    it('starts counting from start() rather than waiting to be backgrounded', () => {
      feedAccel(HANDHELD_SAMPLES);
      jest.advanceTimersByTime(1000);

      expect(onInteractionData).toHaveBeenLastCalledWith(
        expect.objectContaining({ screenInteractionSeconds: 1 }),
      );
    });

    it('stops counting after stop()', () => {
      feedAccel(HANDHELD_SAMPLES);
      jest.advanceTimersByTime(1000);
      manager.stop();

      jest.advanceTimersByTime(5000);

      expect(manager.getSnapshot().screenInteractionSeconds).toBe(1);
    });

    it('resets the counters on a fresh start()', () => {
      feedAccel(HANDHELD_SAMPLES);
      jest.advanceTimersByTime(2000);
      expect(manager.getSnapshot().screenInteractionSeconds).toBe(2);

      manager.start();

      expect(manager.getSnapshot().screenInteractionSeconds).toBe(0);
      expect(manager.getSnapshot().touchEpochs).toBe(0);
    });

    it('does not leave a second timer running when start() is called twice', () => {
      manager.start();
      feedAccel(HANDHELD_SAMPLES);
      jest.advanceTimersByTime(1000);

      // Two intervals would count the same second twice.
      expect(manager.getSnapshot().screenInteractionSeconds).toBe(1);
    });
  });

  // ─── Vehicle speed passthrough (CAR-62) ────────────────────────────────────
  describe('vehicle speed', () => {
    it('reports 0 until the host provides a speed', () => {
      feedAccel([2.5]);
      jest.advanceTimersByTime(1000);

      expect(onInteractionData).toHaveBeenCalledWith(
        expect.objectContaining({ speedKmh: 0 }),
      );
    });

    it('attaches the last reported speed to a touch epoch', () => {
      manager.updateSpeed(62.5);
      feedAccel([2.5]);
      jest.advanceTimersByTime(1000);

      expect(onInteractionData).toHaveBeenCalledWith(
        expect.objectContaining({ touchEpochs: 1, speedKmh: 62.5 }),
      );
    });

    it('attaches the last reported speed to each hand-held second', () => {
      manager.updateSpeed(40);
      feedAccel(HANDHELD_SAMPLES);
      jest.advanceTimersByTime(1000);

      expect(onInteractionData).toHaveBeenLastCalledWith(
        expect.objectContaining({ screenInteractionSeconds: 1, speedKmh: 40 }),
      );

      // A new reading replaces the previous one for every emission after it. Each tick's
      // screenInteractionSeconds is a delta (CAR-175), so it stays 1 on the second tick too.
      manager.updateSpeed(0);
      feedAccel(HANDHELD_SAMPLES);
      jest.advanceTimersByTime(1000);

      expect(onInteractionData).toHaveBeenLastCalledWith(
        expect.objectContaining({ screenInteractionSeconds: 1, speedKmh: 0 }),
      );
    });

    it('does not interpret the speed — hand-held seconds accumulate at a standstill too', () => {
      // No minimum-speed rule inside the SDK: whether a stationary second counts is
      // the host's decision (CAR-54), and it needs the seconds to decide from.
      manager.updateSpeed(0);
      feedAccel(HANDHELD_SAMPLES);
      jest.advanceTimersByTime(1000);

      expect(onEvent).toHaveBeenCalledTimes(1);
      expect(manager.getSnapshot().screenInteractionSeconds).toBe(1);
    });

    it('clears the reported speed on start so a trip cannot inherit the last one', () => {
      manager.updateSpeed(90);
      manager.start();

      expect(manager.getSnapshot().speedKmh).toBe(0);
    });
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

    it('treats the rotation window as empty once the gyro feed goes quiet mid-trip', () => {
      manager.pushGyroSample(5, 0, 0);
      expect(manager.getMotionFeatures().rotationSampleCount).toBe(1);

      jest.advanceTimersByTime(1001); // no further pushGyroSample() calls

      const features = manager.getMotionFeatures();
      expect(features.rotationSampleCount).toBe(0);
      expect(features.rotationVariance).toBe(0);
    });

    it('discards pre-gap samples on the first push after the gap, not just on read', () => {
      // Nine samples, then a gap wide enough to go stale, then one fresh push. A window
      // trimmed only by length (not by age) would still hold the nine pre-gap samples
      // plus the new one and read as non-stale, since lastGyroMs just moved.
      for (let i = 0; i < 9; i++) manager.pushGyroSample(5, 0, 0);
      jest.advanceTimersByTime(1001);
      manager.pushGyroSample(0.05, 0, 0);

      const features = manager.getMotionFeatures();
      expect(features.rotationSampleCount).toBe(1);
      expect(features.rotationRateMean).toBeCloseTo(0.05, 6);
    });
  });

  // ─── Paired-peak tap signature (CAR-260) ───────────────────────────────────
  // The accelerometer tap proxy thresholds one axis-blind magnitude, so a pothole over
  // 1.8 g reads exactly like a finger. The patent's signature is a paired *rotational*
  // kick, twice in quick succession, which is what these cases pin.
  describe('gyroscope tap signature', () => {
    /** One qualifying pair: both in-plane axes inside the band, then back out of it. */
    function kick(atMs = 0) {
      if (atMs) jest.advanceTimersByTime(atMs);
      manager.pushGyroSample(0.4, 0.4, 0);
      manager.pushGyroSample(0.01, 0.01, 0); // falls out, so the next kick is a new edge
    }

    it('reports no taps until two pairs land close together', () => {
      expect(manager.getMotionFeatures().gyroTapPairs).toBe(0);

      kick();
      expect(manager.getMotionFeatures().gyroTapPairs).toBe(0); // one pair is not a tap

      kick(100);
      expect(manager.getMotionFeatures().gyroTapPairs).toBe(1);
    });

    it('does not pair two kicks further apart than the repeat gap', () => {
      kick();
      kick(500); // past TAP_REPEAT_GAP_MS

      expect(manager.getMotionFeatures().gyroTapPairs).toBe(0);
    });

    // The whole point of the signature: a jolt through the suspension drives the
    // accelerometer hard and rotates the phone either far too much or barely at all.
    it('ignores rotation outside the band, however strong', () => {
      manager.pushGyroSample(3.0, 3.0, 0); // a real tumble, well above the band
      manager.pushGyroSample(0.01, 0.01, 0);
      manager.pushGyroSample(3.0, 3.0, 0);
      manager.pushGyroSample(0.01, 0.01, 0);

      expect(manager.getMotionFeatures().gyroTapPairs).toBe(0);
    });

    it('requires both in-plane axes, not one', () => {
      manager.pushGyroSample(0.4, 0.01, 0); // X only
      manager.pushGyroSample(0.01, 0.01, 0);
      manager.pushGyroSample(0.4, 0.01, 0);
      manager.pushGyroSample(0.01, 0.01, 0);

      expect(manager.getMotionFeatures().gyroTapPairs).toBe(0);
    });

    // Z is the vehicle's own yaw in a flat mounting. Counting it would let a turn of the
    // whole car qualify as somebody typing.
    it('does not read the vehicle turning as a tap', () => {
      manager.pushGyroSample(0.01, 0.01, 0.4);
      manager.pushGyroSample(0.01, 0.01, 0.01);
      manager.pushGyroSample(0.01, 0.01, 0.4);
      manager.pushGyroSample(0.01, 0.01, 0.01);

      expect(manager.getMotionFeatures().gyroTapPairs).toBe(0);
    });

    it('counts one kick once, however many samples it spans', () => {
      // A single kick held across four samples is one pair, not four.
      for (let i = 0; i < 4; i++) manager.pushGyroSample(0.4, 0.4, 0);
      manager.pushGyroSample(0.01, 0.01, 0);
      kick(100);

      expect(manager.getMotionFeatures().gyroTapPairs).toBe(1);
    });

    it('ages a tap out of the analysis window', () => {
      kick();
      kick(100);
      expect(manager.getMotionFeatures().gyroTapPairs).toBe(1);

      // Keep the feed alive past the window so staleness is not what clears it.
      for (let i = 0; i < 12; i++) {
        jest.advanceTimersByTime(100);
        manager.pushGyroSample(0.01, 0.01, 0);
      }

      expect(manager.getMotionFeatures().gyroTapPairs).toBe(0);
    });

    it('leaves the hand-held counter alone', () => {
      feedAccel(HANDHELD_SAMPLES);
      kick();
      kick(100);

      // A tap is a raw feature. What it is worth is the consumer's call, and the
      // hand-held veto is a different question entirely (CAR-174/CAR-183).
      expect(manager.getMotionFeatures().gyroTapPairs).toBe(1);
      expect(manager.getSnapshot().screenInteractionSeconds).toBe(0);
    });
  });

  // ─── Rotation veto (CAR-174) ────────────────────────────────────────────────
  // High acceleration variance alone is ambiguous — both a hand and a phone loose
  // on the seat bounce. Only rotation variance tells them apart.
  describe('rotation veto (CAR-174)', () => {
    it('does not count a loose phone (high accel, high rotation) as hand-held', () => {
      feedAccel(HANDHELD_SAMPLES);
      for (let i = 0; i < 10; i++) manager.pushGyroSample(i % 2 === 0 ? 4 : 0, 0, 0);
      jest.advanceTimersByTime(1000);

      expect(onEvent).not.toHaveBeenCalled();
      expect(manager.getSnapshot().screenInteractionSeconds).toBe(0);
      expect(onInteractionData).toHaveBeenLastCalledWith(
        expect.objectContaining({ screenInteractionSeconds: 0 }),
      );
    });

    it('counts genuine hand-held use (high accel, low/stable rotation)', () => {
      feedAccel(HANDHELD_SAMPLES);
      for (let i = 0; i < 10; i++) manager.pushGyroSample(0.05, 0, 0);
      jest.advanceTimersByTime(1000);

      expect(onEvent).toHaveBeenCalledTimes(1);
      expect(onInteractionData).toHaveBeenLastCalledWith(
        expect.objectContaining({ screenInteractionSeconds: 1 }),
      );
    });

    it('falls back to acceleration alone when no gyro sample was ever pushed', () => {
      // Covered by the existing hand-held-accounting tests (no pushGyroSample calls
      // there), which must keep passing unchanged: an empty rotation window computes
      // a variance of 0, which always clears the veto threshold on its own.
      feedAccel(HANDHELD_SAMPLES);
      jest.advanceTimersByTime(1000);

      expect(onEvent).toHaveBeenCalledTimes(1);
    });
  });
});
