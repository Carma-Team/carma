/**
 * @fileoverview Unit tests for SensorManager — GPS+IMU motion-event detection
 *
 * Thresholds are injected through the constructor rather than read from
 * DEFAULT_MOTION_THRESHOLDS, so retuning the shipped defaults cannot break this
 * suite: it pins the detection *logic*, not the numbers currently in the file.
 *
 * The headline case is orientation invariance — the property the GPS+IMU fusion
 * exists to provide, and the one a per-axis regression would silently undo.
 */
import { DrivingEventType, DrivingEvent } from '@/lib/driving-sdk/types';

// ─── Mocks ────────────────────────────────────────────────────────────────────
// Names are `mock`-prefixed so they survive jest's factory hoisting under both
// the current ts-jest transform and babel (jest-expo).

let mockLocationHandler: ((loc: any) => void) | null = null;
let mockAccelHandler: ((d: { x: number; y: number; z: number }) => void) | null = null;
let mockAccelAvailable = true;

// Mocking the task module is what gives the test a handle on the GPS stream:
// SensorManager registers its handler here, so fixes can be injected directly
// without standing up TaskManager.
jest.mock('@/lib/driving-sdk/sensors/locationTask', () => ({
  DRIVING_SDK_LOCATION_TASK: 'driving-sdk-location-task',
  setLocationHandler: jest.fn((h: any) => { mockLocationHandler = h; }),
}));

jest.mock('expo-location', () => ({
  Accuracy: { High: 4, BestForNavigation: 5 },
  ActivityType: { Other: 1, AutomotiveNavigation: 2 },
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestBackgroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  hasStartedLocationUpdatesAsync: jest.fn(async () => false),
  startLocationUpdatesAsync: jest.fn(async () => undefined),
  stopLocationUpdatesAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-sensors', () => ({
  Accelerometer: {
    isAvailableAsync: jest.fn(async () => mockAccelAvailable),
    setUpdateInterval: jest.fn(),
    addListener: jest.fn((h: any) => { mockAccelHandler = h; return { remove: jest.fn() }; }),
  },
  Gyroscope: {
    isAvailableAsync: jest.fn(async () => true),
    setUpdateInterval: jest.fn(),
    addListener: jest.fn(() => ({ remove: jest.fn() })),
  },
}));

import { SensorManager } from '@/lib/driving-sdk/sensors/SensorManager';

// ─── Fixtures & helpers ───────────────────────────────────────────────────────

const MS2_PER_G = 9.81;
// Mirrors SensorManager's own LPF_ALPHA — not imported, same reasoning as MS2_PER_G above.
const LPF_ALPHA = 0.9;

// Deliberately not DEFAULT_MOTION_THRESHOLDS — see file header.
const THRESHOLDS = {
  brakeThresholdMs2: 2.7,
  accelThresholdMs2: 3.0,
  turnThresholdMs2: 3.5,
};

type Vec = { x: number; y: number; z: number };

// Fixture timestamps are offsets from a real epoch value, never from 0.
// SensorManager uses `motionPrevMs === 0` as its "window not seeded yet"
// sentinel, so a fix stamped 0 re-seeds forever and no window is ever evaluated.
const T0 = 1_700_000_000_000;

/** A GPS fix. `speed: null` models expo's "speed unavailable" sentinel (-1). */
function fix(opts: { t: number; speed: number | null; heading?: number; lat?: number; lng?: number }) {
  return {
    timestamp: T0 + opts.t,
    coords: {
      latitude: opts.lat ?? 32.0853,
      longitude: opts.lng ?? 34.7818,
      altitude: 0,
      accuracy: 5,
      altitudeAccuracy: 5,
      heading: opts.heading ?? -1,
      speed: opts.speed === null ? -1 : opts.speed,
    },
  };
}

function sendFix(opts: Parameters<typeof fix>[0]) {
  mockLocationHandler?.(fix(opts));
}

/**
 * Horizontal force strong enough to clear the IMU cross-confirm gate.
 * Phone flat (gravity EMA still at its [0,0,1] seed) + ~1 g along X.
 */
function feedStrongForce() {
  mockAccelHandler?.({ x: 1, y: 0, z: 1 });
}

/** Drives the gravity EMA to `g` so the phone reads as held in that orientation. */
function settleGravity(g: Vec, samples = 300) {
  for (let i = 0; i < samples; i++) mockAccelHandler?.(g);
}

function scale(v: Vec, k: number): Vec {
  return { x: v.x * k, y: v.y * k, z: v.z * k };
}

function add(a: Vec, b: Vec): Vec {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('SensorManager', () => {
  let onEvent: jest.Mock<void, [DrivingEvent]>;
  let onUpdate: jest.Mock;
  let manager: SensorManager;

  const events = () => onEvent.mock.calls.map(([e]) => e);
  const typesFired = () => events().map((e) => e.type);

  beforeEach(async () => {
    // Fake timers keep Date.now() deterministic — SensorManager stamps the
    // cross-confirm streak (durationMs) off the wall clock.
    jest.useFakeTimers();
    mockLocationHandler = null;
    mockAccelHandler = null;
    mockAccelAvailable = true;
    onEvent = jest.fn();
    onUpdate = jest.fn();
    manager = new SensorManager(onEvent, onUpdate, THRESHOLDS);
    await manager.start();
  });

  afterEach(() => {
    manager.stop();
    jest.useRealTimers();
  });

  // ── Window discipline ──────────────────────────────────────────────────────

  it('treats the first fix as a seed only — nothing to compare against yet', () => {
    feedStrongForce();
    sendFix({ t: 0, speed: 20 });

    expect(onEvent).not.toHaveBeenCalled();
  });

  it('keeps accumulating while the evaluation window is under 1.5s', () => {
    sendFix({ t: 0, speed: 20 });
    feedStrongForce();
    // A 6 m/s drop — unmistakably a hard brake, but only 1s of window.
    sendFix({ t: 1000, speed: 14 });

    expect(onEvent).not.toHaveBeenCalled();
  });

  // ── Longitudinal: brake / accel ────────────────────────────────────────────

  it('fires HARD_BRAKE on sustained deceleration past the threshold', () => {
    sendFix({ t: 0, speed: 20 });
    feedStrongForce();
    sendFix({ t: 2000, speed: 14 }); // −3.0 m/s² over 2s

    expect(typesFired()).toEqual([DrivingEventType.HARD_BRAKE]);
  });

  it('fires AGGRESSIVE_ACCEL on the mirrored case', () => {
    sendFix({ t: 0, speed: 10 });
    feedStrongForce();
    sendFix({ t: 2000, speed: 17 }); // +3.5 m/s² over 2s

    expect(typesFired()).toEqual([DrivingEventType.AGGRESSIVE_ACCEL]);
  });

  it('carries durationMs on a motion event', () => {
    sendFix({ t: 0, speed: 20 });
    feedStrongForce();
    jest.advanceTimersByTime(300);
    feedStrongForce(); // still above the confirm gate 300ms later
    sendFix({ t: 2000, speed: 14 });

    const [event] = events();
    expect(event.durationMs).toBeGreaterThanOrEqual(300);
  });

  it('reports the duration of the streak holding the peak, not the longest streak', () => {
    sendFix({ t: 0, speed: 20 });

    // A weaker but longer streak — above the confirm gate, below the peak below.
    mockAccelHandler?.(scale({ x: 1, y: 0, z: 1 }, 0.3));
    jest.advanceTimersByTime(600);
    mockAccelHandler?.(scale({ x: 1, y: 0, z: 1 }, 0.3));

    // Gap: drops below the confirm gate, breaking the streak.
    mockAccelHandler?.({ x: 0, y: 0, z: 1 });

    // Shorter, stronger streak — becomes the new peak.
    feedStrongForce();
    jest.advanceTimersByTime(100);
    feedStrongForce();

    sendFix({ t: 2000, speed: 14 });

    const [event] = events();
    expect(event.durationMs).toBeGreaterThanOrEqual(100);
    expect(event.durationMs).toBeLessThan(300);
  });

  // ── IMU cross-confirmation ─────────────────────────────────────────────────

  it('rejects a GPS-only spike the phone never physically felt', () => {
    sendFix({ t: 0, speed: 20 });
    // No accelerometer samples at all — peak horizontal force stays 0.
    sendFix({ t: 2000, speed: 14 });

    expect(onEvent).not.toHaveBeenCalled();
  });

  it('skips cross-confirmation entirely when the device has no accelerometer', async () => {
    manager.stop();
    mockAccelAvailable = false;
    onEvent.mockClear();
    manager = new SensorManager(onEvent, onUpdate, THRESHOLDS);
    await manager.start();

    sendFix({ t: 0, speed: 20 });
    sendFix({ t: 2000, speed: 14 });

    expect(typesFired()).toEqual([DrivingEventType.HARD_BRAKE]);
    // No hardware — accelInitFailed stays false, distinct from a registration failure (CAR-189).
    const lastUpdate = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
    expect(lastUpdate).toMatchObject({ accelAvailable: false, accelInitFailed: false });
  });

  it('still registers the accelerometer when location startup throws', async () => {
    manager.stop();
    // Throws after permission is granted and setLocationHandler has already run —
    // matching where the reported failures actually land — so the fix under test
    // (accelerometer registration no longer shares a try with this) is what's exercised,
    // not an artifact of the location handler never getting wired up.
    const locationModule = jest.requireMock('expo-location');
    locationModule.startLocationUpdatesAsync.mockRejectedValueOnce(new Error('boom'));
    onEvent.mockClear();
    manager = new SensorManager(onEvent, onUpdate, THRESHOLDS);
    await manager.start();

    sendFix({ t: 0, speed: 20 });
    feedStrongForce();
    sendFix({ t: 2000, speed: 14 });

    // typesFired() alone doesn't prove the accelerometer is live — on the pre-fix
    // code this event still fires (imuConfirms fails open when accelAvailable is
    // false), and feedStrongForce() never reaching a real subscription would leave
    // onUpdate's accelX at 0. A nonzero accelX is what only the fix makes possible.
    const [event] = events();
    expect(event.type).toBe(DrivingEventType.HARD_BRAKE);
    const lastUpdate = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
    expect(lastUpdate.accelX).toBeGreaterThan(0);
  });

  it('fails closed — not open — when accelerometer registration itself throws', async () => {
    manager.stop();
    const sensorsModule = jest.requireMock('expo-sensors');
    sensorsModule.Accelerometer.isAvailableAsync.mockRejectedValueOnce(new Error('boom'));
    onEvent.mockClear();
    manager = new SensorManager(onEvent, onUpdate, THRESHOLDS);
    await manager.start();

    // Same GPS-only spike the hardware-absent test above lets through — a
    // registration failure must not be treated as "no hardware".
    sendFix({ t: 0, speed: 20 });
    sendFix({ t: 2000, speed: 14 });

    expect(onEvent).not.toHaveBeenCalled();
    // Hardware present, registration threw — the outward flag must say so, not "no hardware" (CAR-189).
    const lastUpdate = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
    expect(lastUpdate).toMatchObject({ accelAvailable: false, accelInitFailed: true });
  });

  // ── Lateral: turns ─────────────────────────────────────────────────────────

  it('fires SHARP_TURN from heading rate × speed', () => {
    sendFix({ t: 0, speed: 20, heading: 0 });
    feedStrongForce();
    sendFix({ t: 2000, speed: 20, heading: 40 }); // ~6.9 m/s² lateral

    expect(typesFired()).toEqual([DrivingEventType.SHARP_TURN]);
  });

  it('ignores turns below the speed where GPS heading becomes reliable', () => {
    // 2.5 m/s is under the ~2.8 m/s floor. The lateral figure alone would clear
    // the threshold (~4.6 m/s²), so only the speed gate can suppress this.
    sendFix({ t: 0, speed: 2.5, heading: 0 });
    feedStrongForce();
    sendFix({ t: 1600, speed: 2.5, heading: 170 });

    expect(onEvent).not.toHaveBeenCalled();
  });

  it('reads a 350° → 10° heading change as 20°, not 340°', () => {
    sendFix({ t: 0, speed: 15, heading: 350 });
    feedStrongForce();
    sendFix({ t: 2000, speed: 15, heading: 10 });

    // 20° over 2s at 15 m/s is ~2.6 m/s² — under the threshold. Without
    // wrap-around normalisation this would read as 340° and ~44 m/s².
    expect(onEvent).not.toHaveBeenCalled();
  });

  // ── Orientation invariance — the point of the GPS+IMU fusion ───────────────

  it('fires a motion event regardless of how the phone is oriented', async () => {
    // Four mountings, and for each a force of equal magnitude applied
    // perpendicular to that orientation's gravity vector. A per-axis detector
    // would miss most of these; the horizontal-magnitude projection must not.
    const cases: { name: string; gravity: Vec; force: Vec }[] = [
      { name: 'flat',     gravity: { x: 0, y: 0, z: 1 }, force: { x: 0.5, y: 0, z: 0 } },
      { name: 'upright',  gravity: { x: 0, y: 1, z: 0 }, force: { x: 0.5, y: 0, z: 0 } },
      { name: 'on edge',  gravity: { x: 1, y: 0, z: 0 }, force: { x: 0, y: 0.5, z: 0 } },
      {
        name: 'tilted',
        gravity: { x: 0.5774, y: 0.5774, z: 0.5774 },
        force:   { x: 0.3536, y: -0.3536, z: 0 }, // ⊥ to the above, magnitude 0.5
      },
    ];

    for (const c of cases) {
      manager.stop();
      onEvent.mockClear();
      onUpdate.mockClear();
      manager = new SensorManager(onEvent, onUpdate, THRESHOLDS);
      await manager.start();

      settleGravity(c.gravity);
      // Seed the window first — settling the EMA transiently looks like motion,
      // and seeding resets the peak so only the deliberate force is measured.
      sendFix({ t: 0, speed: 20 });
      mockAccelHandler?.(add(c.gravity, c.force));
      sendFix({ t: 2000, speed: 14 });

      expect(typesFired()).toEqual([DrivingEventType.HARD_BRAKE]);

      // An event firing here doesn't prove gravity was removed — since CAR-156
      // dropped peakG, nothing on the event does. onUpdate's accelX still carries
      // the gravity-removed dynamic X (this.latestAccelX): if removal broke, it
      // would report c.gravity.x + c.force.x instead of just c.force.x, scaled
      // down by one sample of the LPF_ALPHA gravity EMA settling toward the force.
      const lastUpdate = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
      expect(lastUpdate.accelX).toBeCloseTo(c.force.x * LPF_ALPHA, 5);
    }
  });

  // ── GPS hygiene ────────────────────────────────────────────────────────────

  it('drops a near-duplicate fix arriving under 500ms after the previous one', () => {
    sendFix({ t: 0, speed: 20 });
    sendFix({ t: 300, speed: 20 });

    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('holds the last known speed through an unavailable reading instead of reporting 0', () => {
    sendFix({ t: 0, speed: 20 });
    onUpdate.mockClear();
    sendFix({ t: 2000, speed: null });

    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ currentSpeed: 20 * 3.6 }),
    );
  });

  it('does not read a speed dropout as a hard brake', () => {
    sendFix({ t: 0, speed: 20 });
    feedStrongForce();
    sendFix({ t: 2000, speed: null });   // sentinel, not a stop
    feedStrongForce();
    sendFix({ t: 4000, speed: 20 });     // lock recovers at the same speed

    // Clamping the sentinel to 0 would produce a brake then an acceleration.
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('decays a held speed back to 0 once it has been stale for 10s', () => {
    sendFix({ t: 0, speed: 20 });
    onUpdate.mockClear();
    sendFix({ t: 11000, speed: null });

    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ currentSpeed: 0 }),
    );
  });

  it('reports no distance between two fixes at the same coordinates', () => {
    sendFix({ t: 0, speed: 0, lat: 32.0853, lng: 34.7818 });
    onUpdate.mockClear();
    sendFix({ t: 2000, speed: 0, lat: 32.0853, lng: 34.7818 });

    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ distanceKm: 0 }),
    );
  });

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  it('is idempotent on repeated start and stop', async () => {
    await expect(manager.start()).resolves.toBeUndefined();

    manager.stop();
    expect(() => manager.stop()).not.toThrow();
  });

  it('detaches the location handler on stop', () => {
    manager.stop();
    expect(mockLocationHandler).toBeNull();
  });
});
