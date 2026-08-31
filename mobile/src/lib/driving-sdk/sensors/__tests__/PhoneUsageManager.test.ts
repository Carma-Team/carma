import { DrivingEventType } from '@/lib/driving-sdk/types';
import { PhoneUsageManager } from '@/lib/driving-sdk/sensors/PhoneUsageManager';

// ─── Helpers ─────────────────────────────────────────────────────────────────
// No sensor mock: the manager subscribes to nothing. Gyroscope samples are pushed in
// by the host (CAR-82), AppState is not consulted (CAR-45), and the accelerometer is
// not read at all since v2.0 (CAR-187).

describe('PhoneUsageManager', () => {
  let onEvent: jest.Mock;
  let onInteractionData: jest.Mock;
  let manager: PhoneUsageManager;

  /** One qualifying pair: both in-plane axes inside the band, then back out of it. */
  function kick(atMs = 0) {
    if (atMs) jest.advanceTimersByTime(atMs);
    manager.pushGyroSample(0.4, 0.4, 0);
    manager.pushGyroSample(0.01, 0.01, 0); // falls out, so the next kick is a new edge
  }

  /** Two pairs inside the repeat gap — one completed tap, which is the cadence. */
  function tapCadence() {
    kick();
    kick(100);
  }

  /**
   * The phone being moved with no tap in it: rotation well outside the tap band and
   * swinging enough to clear the variance threshold.
   */
  function handling() {
    for (let i = 0; i < 10; i++) manager.pushGyroSample(i % 2 === 0 ? 4 : 0, 0, 0);
  }

  /** A phone that only turns with the vehicle — under the threshold, no pairs. */
  function atRest() {
    for (let i = 0; i < 10; i++) manager.pushGyroSample(0.01, 0.01, 0);
  }

  /** Runs the 1 s tick from wherever inside the current second the clock sits. */
  function tick(fromMs = 0) {
    jest.advanceTimersByTime(1000 - fromMs);
  }

  beforeEach(() => {
    jest.useFakeTimers();
    onEvent = jest.fn();
    onInteractionData = jest.fn();
    manager = new PhoneUsageManager(onEvent, onInteractionData);
    manager.start();
  });

  afterEach(() => {
    manager.stop();
    jest.useRealTimers();
  });

  // ─── The discrete event ────────────────────────────────────────────────────
  describe('PHONE_USAGE', () => {
    it('does not fire without gyroscope evidence (Siri, calls, Control Center)', () => {
      tick();
      expect(onEvent).not.toHaveBeenCalled();
    });

    it('does not fire for a phone that only turns with the vehicle', () => {
      atRest();
      tick();
      expect(onEvent).not.toHaveBeenCalled();
    });

    it('fires once per distracted stretch, not once per second', () => {
      handling();
      tick();
      expect(onEvent).toHaveBeenCalledTimes(1);
      expect(onEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: DrivingEventType.PHONE_USAGE }),
      );

      handling();
      tick();
      expect(onEvent).toHaveBeenCalledTimes(1);
    });

    it('fires again after the phone is put down and picked up a second time', () => {
      handling();
      tick();
      expect(onEvent).toHaveBeenCalledTimes(1);

      atRest();
      tick();
      expect(onEvent).toHaveBeenCalledTimes(1);

      handling();
      tick();
      expect(onEvent).toHaveBeenCalledTimes(2);
    });
  });

  // ─── The two counters (CAR-187) ────────────────────────────────────────────
  // Screen interaction is a tap cadence; phone motion is the phone being moved
  // without one. They are mutually exclusive and screen interaction wins.
  describe('the two distraction counters', () => {
    it('counts a second carrying a tap cadence as screen interaction', () => {
      tapCadence();
      tick(100);

      expect(onInteractionData).toHaveBeenLastCalledWith(
        expect.objectContaining({ screenInteractionSeconds: 1, phoneMotionSeconds: 0 }),
      );
    });

    it('counts a second of movement without a cadence as phone motion', () => {
      handling();
      tick();

      expect(onInteractionData).toHaveBeenLastCalledWith(
        expect.objectContaining({ screenInteractionSeconds: 0, phoneMotionSeconds: 1 }),
      );
    });

    // Typing necessarily moves the phone, so without the precedence one second of it
    // would count twice — once against each baseline.
    it('never counts one second as both', () => {
      handling();
      tapCadence();
      tick(100);

      expect(onInteractionData).toHaveBeenLastCalledWith(
        expect.objectContaining({ screenInteractionSeconds: 1, phoneMotionSeconds: 0 }),
      );
    });

    it('counts neither for a phone at rest', () => {
      atRest();
      tick();

      expect(onInteractionData).toHaveBeenLastCalledWith(
        expect.objectContaining({ screenInteractionSeconds: 0, phoneMotionSeconds: 0 }),
      );
    });

    it('emits every second regardless of outcome, as a delta (CAR-175)', () => {
      handling();
      tick();
      handling();
      tick();

      expect(onInteractionData).toHaveBeenCalledTimes(2);
      expect(manager.getSnapshot().phoneMotionSeconds).toBe(2);
      expect(onInteractionData).toHaveBeenLastCalledWith(
        expect.objectContaining({ phoneMotionSeconds: 1 }),
      );
    });

    it('stops counting after stop()', () => {
      handling();
      tick();
      manager.stop();

      jest.advanceTimersByTime(5000);

      expect(manager.getSnapshot().phoneMotionSeconds).toBe(1);
    });

    it('resets both counters on a fresh start()', () => {
      handling();
      tick();
      expect(manager.getSnapshot().phoneMotionSeconds).toBe(1);

      manager.start();

      expect(manager.getSnapshot().phoneMotionSeconds).toBe(0);
      expect(manager.getSnapshot().screenInteractionSeconds).toBe(0);
    });

    it('does not leave a second timer running when start() is called twice', () => {
      manager.start();
      handling();
      tick();

      // Two intervals would count the same second twice.
      expect(manager.getSnapshot().phoneMotionSeconds).toBe(1);
    });
  });

  // ─── Vehicle speed passthrough (CAR-62) ────────────────────────────────────
  describe('vehicle speed', () => {
    it('reports 0 until the host provides a speed', () => {
      handling();
      tick();

      expect(onInteractionData).toHaveBeenCalledWith(
        expect.objectContaining({ speedKmh: 0 }),
      );
    });

    it('attaches the last reported speed to each emission', () => {
      manager.updateSpeed(40);
      handling();
      tick();

      expect(onInteractionData).toHaveBeenLastCalledWith(
        expect.objectContaining({ phoneMotionSeconds: 1, speedKmh: 40 }),
      );

      manager.updateSpeed(0);
      handling();
      tick();

      expect(onInteractionData).toHaveBeenLastCalledWith(
        expect.objectContaining({ phoneMotionSeconds: 1, speedKmh: 0 }),
      );
    });

    it('does not interpret the speed — seconds accumulate at a standstill too', () => {
      // No minimum-speed rule inside the SDK: whether a stationary second counts is
      // the host's decision (CAR-54), and it needs the seconds to decide from.
      manager.updateSpeed(0);
      handling();
      tick();

      expect(onEvent).toHaveBeenCalledTimes(1);
      expect(manager.getSnapshot().phoneMotionSeconds).toBe(1);
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
    it('reports empty features when no gyroscope samples arrive', () => {
      const features = manager.getMotionFeatures();

      expect(features.rotationSampleCount).toBe(0);
      expect(features.rotationRateMean).toBe(0);
      expect(features.rotationVariance).toBe(0);
      expect(features.gyroTapPairs).toBe(0);
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
      manager.pushGyroSample(3, 4, 0); // magnitude 5

      expect(manager.getMotionFeatures().rotationRateMean).toBeCloseTo(5, 6);
    });

    it('keeps the rotation window to a 1-second span', () => {
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
  // A jolt through the suspension rotates the phone either far too much or barely at
  // all; a finger rotates it about both in-plane axes at once. These cases pin that.
  describe('gyroscope tap signature', () => {
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
      tapCadence();
      expect(manager.getMotionFeatures().gyroTapPairs).toBe(1);

      // Keep the feed alive past the window so staleness is not what clears it.
      for (let i = 0; i < 12; i++) {
        jest.advanceTimersByTime(100);
        manager.pushGyroSample(0.01, 0.01, 0);
      }

      expect(manager.getMotionFeatures().gyroTapPairs).toBe(0);
    });
  });
});
