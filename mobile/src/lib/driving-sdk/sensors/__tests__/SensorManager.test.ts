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
let mockGyroHandler: ((d: { x: number; y: number; z: number }) => void) | null = null;
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
    addListener: jest.fn((h: any) => { mockGyroHandler = h; return { remove: jest.fn() }; }),
  },
}));

import { SensorManager } from '@/lib/driving-sdk/sensors/SensorManager';

// ─── Fixtures & helpers ───────────────────────────────────────────────────────

const MS2_PER_G = 9.81;
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
    mockGyroHandler = null;
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
    // code this event still fires, because imuConfirms fails open when accelAvailable
    // is false. The flag is what separates the two: it can only be true if the
    // subscription was established and feedStrongForce() reached it.
    const [event] = events();
    expect(event.type).toBe(DrivingEventType.HARD_BRAKE);
    const lastUpdate = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
    expect(lastUpdate).toMatchObject({ accelAvailable: true, accelInitFailed: false });
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

  // ── Accelerometer coverage over the window ─────────────────────────────────
  // `accelAvailable` is a boolean about right now, and it latches over a trip — so a
  // sensor that quit halfway reads exactly like one that ran the whole way. These
  // three cases are the three answers the fraction has to keep apart.

  /** Delivers `n` samples at the 10 Hz the subscription requests. */
  function feedAccelFor(n: number) {
    for (let i = 0; i < n; i++) {
      jest.advanceTimersByTime(100);
      mockAccelHandler?.({ x: 0, y: 0, z: 1 });
    }
  }

  const coverage = () => onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0].accelCoverage;

  it('reports full coverage while the accelerometer keeps delivering', () => {
    feedAccelFor(20); // 2 s of samples over a 2 s window

    sendFix({ t: 0, speed: 20 });

    expect(coverage()).toBeCloseTo(1, 2);
  });

  it('reports partial coverage for a sensor that goes quiet mid-window', () => {
    feedAccelFor(10);           // 1 s live
    jest.advanceTimersByTime(10_000); // 10 s of silence — well past SENSOR_STALE_MS
    feedAccelFor(10);           // it comes back

    sendFix({ t: 0, speed: 20 });

    // The outage is not retroactively credited when the sensor returns, so the
    // fraction stays far from 1 — and it is not 0 either, which is the whole point.
    expect(coverage()).toBeGreaterThan(0);
    expect(coverage()).toBeLessThan(0.25);
  });

  it('reports zero coverage when there is no accelerometer at all', async () => {
    manager.stop();
    mockAccelAvailable = false;
    manager = new SensorManager(onEvent, onUpdate, THRESHOLDS);
    await manager.start();

    jest.advanceTimersByTime(2000);
    sendFix({ t: 0, speed: 20 });

    expect(coverage()).toBe(0);
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

      // The event fires from the same applied magnitude in all four mountings, which
      // is the invariance being pinned. That gravity was actually removed, and that
      // the surviving force lands on the right vehicle axis, is checked directly
      // against the geometry in sensors/__tests__/vehicleFrame.test.ts — the update
      // here carries vehicle-frame values, which are deliberately null until enough
      // GPS evidence has resolved the forward direction.
      const lastUpdate = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
      expect(lastUpdate.lateralAccelG).toBeNull();
    }
  });

  // The four cases above apply their force perpendicular to gravity by construction,
  // so the vertical component is ~0 in every one of them and the projection could be
  // deleted without a single failure. This is the case that needs it: a force entirely
  // along gravity leaves no horizontal component, so the IMU must not cross-confirm
  // the GPS brake. Without the projection the raw magnitude (~0.45 g = 4.4 m/s²)
  // clears IMU_CONFIRM_MS2 and the event fires.
  it('does not cross-confirm a force that is purely vertical', async () => {
    manager.stop();
    onEvent.mockClear();
    manager = new SensorManager(onEvent, onUpdate, THRESHOLDS);
    await manager.start();

    const gravity = { x: 0, y: 0, z: 1 };
    settleGravity(gravity);
    sendFix({ t: 0, speed: 20 });
    mockAccelHandler?.(add(gravity, { x: 0, y: 0, z: 0.5 })); // straight down the gravity axis
    sendFix({ t: 2000, speed: 14 });                          // −3.0 m/s², a real GPS brake

    expect(onEvent).not.toHaveBeenCalled();
  });

  // ── Raw sample taps and GPS metadata passthrough ───────────────────────────

  // The tap exists so RawSampleRecorder doesn't open a second Accelerometer
  // subscription. It must carry the sample *before* gravity removal — the recorder's
  // whole purpose is the unprocessed stream.
  it('offers every accelerometer sample to onAccelSample, ungravity-removed', async () => {
    const onAccelSample = jest.fn();
    manager.stop();
    manager = new SensorManager(onEvent, onUpdate, THRESHOLDS, undefined, onAccelSample);
    await manager.start();

    mockAccelHandler?.({ x: 0.1, y: 0.2, z: 1.0 });
    mockAccelHandler?.({ x: 0.3, y: 0.4, z: 0.9 });

    expect(onAccelSample).toHaveBeenCalledTimes(2);
    expect(onAccelSample).toHaveBeenNthCalledWith(1, { x: 0.1, y: 0.2, z: 1.0 });
    expect(onAccelSample).toHaveBeenNthCalledWith(2, { x: 0.3, y: 0.4, z: 0.9 });
  });

  it('offers every gyroscope sample to onGyroSample', async () => {
    const onGyroSample = jest.fn();
    manager.stop();
    manager = new SensorManager(onEvent, onUpdate, THRESHOLDS, onGyroSample);
    await manager.start();

    mockGyroHandler?.({ x: 0.01, y: 0.02, z: 0.03 });

    expect(onGyroSample).toHaveBeenCalledWith({ x: 0.01, y: 0.02, z: 0.03 });
  });

  // Horizontal accuracy is what the host uses to weigh a fix. `undefined` and a real
  // 0 are different claims, so the null coalesce has to survive: expo reports null
  // when accuracy is unknown, and that must not arrive as a confident 0 metres.
  it('passes GPS accuracy through, and reports unknown accuracy as undefined', () => {
    sendFix({ t: 0, speed: 20 });
    expect(onUpdate.mock.calls[0][0].accuracy).toBe(5);

    const noAccuracy = fix({ t: 2000, speed: 20 });
    noAccuracy.coords.accuracy = null as any;
    mockLocationHandler?.(noAccuracy);

    const last = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
    expect(last.accuracy).toBeUndefined();
    expect('accuracy' in last).toBe(true);
  });

  // ── GPS hygiene ────────────────────────────────────────────────────────────

  it('drops a near-duplicate fix arriving under 500ms after the previous one', () => {
    sendFix({ t: 0, speed: 20 });
    sendFix({ t: 300, speed: 20 });

    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  // A backwards clock step (NTP correction mid-trip) is not the duplicate burst the
  // 500 ms filter exists for. Dropping it would strand lastLocation on the pre-step
  // stamp, so every later fix reads as a duplicate too — the cost is the rest of the
  // trip, not one fix.
  it('re-anchors on a backwards clock step and keeps collecting after it', () => {
    sendFix({ t: 0, speed: 20 });
    sendFix({ t: 2000, speed: 20 });
    onUpdate.mockClear();

    sendFix({ t: -1000, speed: 20 }); // clock steps 3s back
    expect(onUpdate).toHaveBeenCalledTimes(1);
    // Re-anchored, so nothing is measured across the step itself.
    expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ distanceKm: 0 }));

    sendFix({ t: 1000, speed: 20, lat: 32.0953 }); // ~1.1 km on from the fixture
    expect(onUpdate).toHaveBeenCalledTimes(2);
    expect(onUpdate.mock.calls[1][0].distanceKm).toBeGreaterThan(0);
  });

  // The staleness anchor is stamped from fix time, so it has to move with the clock
  // too — left in the future it never expires, and the speed decay stops working.
  it('decays the held speed on the new clock after a backwards step', () => {
    sendFix({ t: 0, speed: 20 });
    sendFix({ t: -3_600_000, speed: null }); // an hour back, speed lock lost with it
    onUpdate.mockClear();

    // 11s past the step on the clock the fixes now arrive on — past STALE_SPEED_MS.
    sendFix({ t: -3_600_000 + 11_000, speed: null });

    expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ currentSpeed: 0 }));
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

  it('leaves no sensor subscriptions behind when stop() runs while start() is still awaiting permissions (CAR-177)', async () => {
    const { requestForegroundPermissionsAsync } = jest.requireMock('expo-location');
    const { Accelerometer, Gyroscope } = jest.requireMock('expo-sensors');
    (Accelerometer.addListener as jest.Mock).mockClear();
    (Gyroscope.addListener as jest.Mock).mockClear();

    let resolvePermission: (v: { status: string }) => void = () => {};
    (requestForegroundPermissionsAsync as jest.Mock).mockImplementationOnce(
      () => new Promise((resolve) => { resolvePermission = resolve; }),
    );

    const raceManager = new SensorManager(onEvent, onUpdate, THRESHOLDS);
    const startPromise = raceManager.start();

    // Simulates a Bluetooth disconnect racing the permission dialog: stop() runs
    // before start()'s first await resolves, while isRunning is already true.
    raceManager.stop();
    resolvePermission({ status: 'granted' });
    await startPromise;

    expect(Accelerometer.addListener).not.toHaveBeenCalled();
    expect(Gyroscope.addListener).not.toHaveBeenCalled();
  });

  it('registers one listener per sensor when a stop/start pair races start() (CAR-177)', async () => {
    const { requestForegroundPermissionsAsync } = jest.requireMock('expo-location');
    const { Accelerometer, Gyroscope } = jest.requireMock('expo-sensors');
    (Accelerometer.addListener as jest.Mock).mockClear();
    (Gyroscope.addListener as jest.Mock).mockClear();

    // Only the first start() stalls; the restart below gets the default granted mock.
    let resolvePermission: (v: { status: string }) => void = () => {};
    (requestForegroundPermissionsAsync as jest.Mock).mockImplementationOnce(
      () => new Promise((resolve) => { resolvePermission = resolve; }),
    );

    const raceManager = new SensorManager(onEvent, onUpdate, THRESHOLDS);
    const stalledStart = raceManager.start();

    // The Bluetooth flap this PR is written around: drops and reconnects while the
    // permission dialog is still up, so a whole second run completes underneath.
    raceManager.stop();
    await raceManager.start();

    // The dialog is answered only now. isRunning is true again — but it is the *new*
    // run's true, which is exactly what the boolean alone could not distinguish.
    resolvePermission({ status: 'granted' });
    await stalledStart;

    expect(Accelerometer.addListener).toHaveBeenCalledTimes(1);
    expect(Gyroscope.addListener).toHaveBeenCalledTimes(1);

    raceManager.stop();
  });

  it('leaves the location task alone when a superseded start() finishes late (CAR-177)', async () => {
    // Pins the conditional half of the fix rather than the original leak: a superseded
    // run must not undo the background task, because a newer run shares it and would
    // lose location tracking mid-trip. A run counter without this check still breaks it.
    const locationModule = jest.requireMock('expo-location');

    let reachedStart: () => void = () => {};
    const parkedInsideStart = new Promise<void>((resolve) => { reachedStart = resolve; });
    let releaseStart: () => void = () => {};
    locationModule.startLocationUpdatesAsync.mockImplementationOnce(
      () => { reachedStart(); return new Promise<void>((resolve) => { releaseStart = resolve; }); },
    );

    const raceManager = new SensorManager(onEvent, onUpdate, THRESHOLDS);
    const stalledStart = raceManager.start();
    await parkedInsideStart;

    raceManager.stop();
    await raceManager.start(); // newer run now owns the location task
    locationModule.stopLocationUpdatesAsync.mockClear();

    releaseStart();
    await stalledStart;

    expect(locationModule.stopLocationUpdatesAsync).not.toHaveBeenCalled();

    raceManager.stop();
  });

  // ── Sensor availability (§3.1 staleness) ───────────────────────────────────
  // docs/fraud-detection.md §3.1: available requires hardware present, subscription
  // active, AND a sample within the last 5s — not just "was present at start()".

  it('reports gyroAvailable: false once the subscription goes quiet, even though isAvailableAsync() said the hardware was present', () => {
    jest.advanceTimersByTime(5000); // SENSOR_STALE_MS — no gyro sample ever arrives, only the start() grace stamp
    sendFix({ t: 5100, speed: 20 });

    const lastUpdate = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
    expect(lastUpdate).toMatchObject({ gyroAvailable: false });
  });

  it('stays gyroAvailable: true past the original window when a sample refreshes it first', () => {
    // Without the per-sample refresh, this crosses SENSOR_STALE_MS on the start()
    // grace stamp alone and would read false — the case Dan's review caught: the
    // old version of this test only ever advanced far enough to see the grace
    // stamp, never far enough past a *refreshed* one to tell the two apart.
    jest.advanceTimersByTime(4000);
    mockGyroHandler?.({ x: 0, y: 0, z: 0.01 }); // refreshes lastGyroSampleAtMs at t=4000
    jest.advanceTimersByTime(4000); // t=8000 — 8000ms since start(), but 4000ms since the refresh
    sendFix({ t: 8000, speed: 20 });

    const lastUpdate = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
    expect(lastUpdate).toMatchObject({ gyroAvailable: true });
  });

  // The availability flag alone is not enough: a consumer that classifies motion reads
  // the value, and a gyro that died mid-trip kept reporting its last yaw forever — which
  // a rail signal counts as a real framed sample. §3.1's unavailable ≠ zero has to cover
  // unavailable ≠ last known too, or staleness is only advisory.
  it('reports yawRateRadS: null once the gyroscope goes quiet, rather than freezing its last reading', () => {
    jest.advanceTimersByTime(1000);
    mockGyroHandler?.({ x: 0, y: 0, z: 0.4 }); // gravity is still the (0,0,1) seed, so yaw about it is 0.4
    sendFix({ t: 1100, speed: 20 });
    expect(onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0])
      .toMatchObject({ yawRateRadS: 0.4 });

    jest.advanceTimersByTime(5000); // SENSOR_STALE_MS with no further sample — the gyro is gone
    sendFix({ t: 6200, speed: 20 });
    expect(onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0])
      .toMatchObject({ yawRateRadS: null, gyroAvailable: false });
  });

  it('reports accelAvailable: false once the subscription goes quiet, even though isAvailableAsync() said the hardware was present', () => {
    jest.advanceTimersByTime(5000);
    sendFix({ t: 5100, speed: 20 });

    const lastUpdate = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
    expect(lastUpdate).toMatchObject({ accelAvailable: false });
  });

  it('stays accelAvailable: true past the original window when a sample refreshes it first', () => {
    jest.advanceTimersByTime(4000);
    mockAccelHandler?.({ x: 0, y: 0, z: 1 }); // refreshes lastAccelSampleAtMs at t=4000
    jest.advanceTimersByTime(4000); // t=8000 — 4000ms since the refresh, not since start()
    sendFix({ t: 8000, speed: 20 });

    const lastUpdate = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
    expect(lastUpdate).toMatchObject({ accelAvailable: true });
  });
});
