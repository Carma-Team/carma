/**
 * @fileoverview Unit tests for DrivingSDK — trip lifecycle and event orchestration
 *
 * This is the safety net for the one file the planned auto-trip-detection
 * refactor actually edits. Two things it has to survive that refactor:
 *
 *  1. The public API is pinned by name. The refactor moves internals into a
 *     strategy layer and promises no caller breaks — this suite is what proves it.
 *  2. Auto-start is exercised through the public trigger only, never through the
 *     Bluetooth-named private handlers. Bluetooth is the Android trigger and stays;
 *     iOS will trigger the same path from continuous background location. Pinning
 *     "what happens when something wakes the SDK" keeps the test valid for both.
 *
 * The three managers are mocked so their constructor callbacks can be driven
 * directly — that is the only way to reach handleEvent/handleSensorUpdate, which
 * hold everything worth testing here.
 */
import {
  DrivingEventType,
  DrivingEvent,
  TripValidator,
  ValidationSample,
  SuspiciousActivityEvaluation,
  SensorUpdate,
} from '@/lib/driving-sdk/types';
import { DrivingSDK } from '@/lib/driving-sdk';

// ─── Mocks ────────────────────────────────────────────────────────────────────
// Names are `mock`-prefixed so they survive jest's factory hoisting under both
// the current ts-jest transform and babel (jest-expo).

let mockSensorEmit: ((event: DrivingEvent) => void) | null = null;
let mockSensorUpdate: ((update: SensorUpdate) => void) | null = null;
// Passthroughs SensorManager exposes so a second consumer can tap an already-open
// subscription (onGyroSample/onAccelSample) — captured here to test that DrivingSDK
// wires RawSampleRecorder into them, same as it wires PhoneUsageManager's gyro tap.
let mockGyroPassthrough: ((sample: { x: number; y: number; z: number }) => void) | null = null;
let mockAccelPassthrough: ((sample: { x: number; y: number; z: number }) => void) | null = null;
let mockPhoneEmit: ((event: DrivingEvent) => void) | null = null;
let mockPhoneInteraction:
  | ((data: { screenInteractionSeconds: number; phoneMotionSeconds: number; speedKmh: number }) => void)
  | null = null;
let mockDetected: (() => void) | null = null;
// The vehicle the detection layer reports as connected, driven per test — the SDK reads
// it once at trip start to stamp the trip's vehicle key (CAR-310).
let mockConnectedVehicleId: string | null = null;
let mockLost: (() => void) | null = null;

const mockSensorStart = jest.fn(async () => undefined);
const mockSensorStop = jest.fn();
const mockSensorResetCoverage = jest.fn();
const mockPhoneStart = jest.fn();
const mockPhoneStop = jest.fn();
const mockPhonePushGyro = jest.fn();
const mockPhonePushAccel = jest.fn();
const mockAutoEnable = jest.fn();
const mockRawStart = jest.fn();
const mockRawStop = jest.fn(async () => undefined);
const mockRawPushAccel = jest.fn();
const mockRawPushGyro = jest.fn();
const mockRawPushLocation = jest.fn();
const mockRawExport = jest.fn(async () => null);

jest.mock('@/lib/driving-sdk/sensors/SensorManager', () => ({
  SensorManager: class {
    constructor(onEvent: any, onUpdate: any, _thresholds: any, onGyroSample: any, onAccelSample: any) {
      mockSensorEmit = onEvent;
      mockSensorUpdate = onUpdate;
      mockGyroPassthrough = onGyroSample;
      mockAccelPassthrough = onAccelSample;
    }
    async start() { return mockSensorStart(); }
    stop() { return mockSensorStop(); }
    resetSensorCoverage() { return mockSensorResetCoverage(); }
  },
}));

jest.mock('@/lib/driving-sdk/sensors/RawSampleRecorder', () => ({
  RawSampleRecorder: class {
    // Mirrors the real class's session flag — DrivingSDK's guard against tearing
    // down shared sensors mid-recording needs this to actually reflect start/stop.
    private recording = false;
    start(...args: any[]) { this.recording = true; return mockRawStart(...args); }
    async stop() { this.recording = false; return mockRawStop(); }
    isRecording() { return this.recording; }
    pushAccelSample(...args: any[]) { return mockRawPushAccel(...args); }
    pushGyroSample(...args: any[]) { return mockRawPushGyro(...args); }
    pushLocationSample(...args: any[]) { return mockRawPushLocation(...args); }
    exportAsync() { return mockRawExport(); }
    listRecordings() { return []; }
  },
}));

jest.mock('@/lib/driving-sdk/sensors/PhoneUsageManager', () => ({
  PhoneUsageManager: class {
    constructor(onEvent: any, onInteractionData: any) {
      mockPhoneEmit = onEvent;
      mockPhoneInteraction = onInteractionData;
    }
    start() { return mockPhoneStart(); }
    stop() { return mockPhoneStop(); }
    updateSpeed() {}
    pushGyroSample(...args: any[]) { return mockPhonePushGyro(...args); }
    pushAccelSample(...args: any[]) { return mockPhonePushAccel(...args); }
  },
}));

jest.mock('@/lib/driving-sdk/auto-trip-detection/AutoDriveModeManager', () => ({
  AutoDriveModeManager: class {
    constructor(onDetected: any, onLost: any) {
      mockDetected = onDetected;
      mockLost = onLost;
    }
    enable(target: string | null) { return mockAutoEnable(target); }
    getConnectedVehicleId() { return mockConnectedVehicleId; }
  },
}));

// Stateless Bluetooth queries the SDK re-exports. Mocked here only to keep the native
// module out of this suite — their own behaviour is covered in bluetoothDevices.test.ts.
jest.mock('@/lib/driving-sdk/auto-trip-detection/bluetoothDevices', () => ({
  getBondedDevices: jest.fn(async () => []),
  getBTSupportStatus: jest.fn(async () => ({
    nativeAvailable: true, btAvailable: true, btEnabled: true, permissionsGranted: true,
  })),
}));

// ─── Fixtures & helpers ───────────────────────────────────────────────────────

/** The 3-second window after startTrip() where events are deliberately dropped. */
const WARMUP_MS = 3000;

/**
 * A validator that does nothing on its own, so a test can decide exactly when a
 * trip is confirmed, ended, or flagged. DefaultTripValidator confirms
 * synchronously from start(), which is right for the zero-config path but hides
 * the delegation being tested here.
 */
class StubValidator implements TripValidator {
  public onTripConfirmed?: () => void;
  public onTripEnded?: () => void;
  public onFraudSuspected?: (evaluation: SuspiciousActivityEvaluation) => void;

  public started = 0;
  public stopped = 0;
  public samples: ValidationSample[] = [];

  start() { this.started++; }
  stop() { this.stopped++; }
  updateSample(sample: ValidationSample) { this.samples.push(sample); }
}

const FRAUD: SuspiciousActivityEvaluation = {
  score: 0.9,
  // A bare string on purpose: `mode` is declared `string` and documented as an opaque
  // passthrough the SDK never reads. Reaching for the host app's TransportMode enum
  // would make the library's own suite depend on an app concept (CAR-335).
  mode: 'TRAIN',
  telemetry: { avgSpeedKmh: 80, maxLateralAccelG: 0.02, yawVariance: 0.001 },
  // A validator's own gate names, one of them unevaluated. The SDK must not read,
  // rename or normalise any of it — see the passthrough assertion below.
  signals: { constantHighSpeed: true, noLateralForce: true, noHeadingChange: null },
};

/**
 * Drains the microtask queue.
 *
 * Both the auto-start path and the validator-confirmed path run behind
 * `await sensorManager.start()` — twice over in the confirm path, since startTrip
 * re-enters the validation branch before its own start call. A fixed one or two
 * ticks silently under-drains that; no timers are involved, so draining fully is
 * deterministic.
 */
async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe('DrivingSDK', () => {
  let sdk: DrivingSDK;
  let onTripStart: jest.Mock;
  let onTripEnd: jest.Mock;
  let onUpdate: jest.Mock;
  let onEventDetected: jest.Mock;
  let onFraudDetected: jest.Mock;

  /** Attaches the lifecycle callbacks to whichever instance a test is using. */
  function wire(instance: DrivingSDK) {
    instance.onTripStart = onTripStart;
    instance.onTripEnd = onTripEnd;
    instance.onUpdate = onUpdate;
    instance.onEventDetected = onEventDetected;
    instance.onFraudDetected = onFraudDetected;
    return instance;
  }

  /** Starts a trip and steps past the warm-up guard, so events are accepted. */
  async function startTripReady(instance: DrivingSDK = sdk) {
    const tripId = await instance.startTrip();
    jest.advanceTimersByTime(WARMUP_MS + 1);
    onUpdate.mockClear();
    return tripId;
  }

  /**
   * Cooldown is measured from the event's own timestamp, while the warm-up guard
   * is measured from the wall clock — two different clocks. `atMs` moves only the
   * former, which is what makes cooldown testable without advancing time.
   */
  function emitSensorEvent(
    type: DrivingEventType,
    opts: { severity?: number; atMs?: number } = {},
  ) {
    mockSensorEmit?.({
      type,
      timestamp: new Date(Date.now() + (opts.atMs ?? 0)),
      severity: opts.severity ?? 0.5,
    });
  }

  function sendSensorUpdate(update: Partial<SensorUpdate> = {}) {
    mockSensorUpdate?.({
      distanceKm: 0,
      currentSpeed: 0,
      timeDeltaS: 2,
      longitudinalAccelG: 0,
      lateralAccelG: 0,
      yawRateRadS: 0,
      accelAvailable: true,
      gyroAvailable: true,
      accelCoverage: 1,
      accelInitFailed: false,
      backgroundLocationAvailable: true,
      ...update,
    });
  }

  const tripData = (instance: DrivingSDK = sdk) => instance.getStatus().tripData;

  beforeEach(() => {
    // Fake timers pin Date.now(): the warm-up guard, the cooldown map and the
    // 1-second duration timer all read it.
    jest.useFakeTimers();
    // The SDK narrates every event to the console; silenced so a green run is readable.
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    mockSensorEmit = null;
    mockSensorUpdate = null;
    mockGyroPassthrough = null;
    mockAccelPassthrough = null;
    mockPhoneEmit = null;
    mockPhoneInteraction = null;
    mockDetected = null;
    mockLost = null;
    mockConnectedVehicleId = null;
    jest.clearAllMocks();

    onTripStart = jest.fn();
    onTripEnd = jest.fn();
    onUpdate = jest.fn();
    onEventDetected = jest.fn();
    onFraudDetected = jest.fn();

    sdk = wire(new DrivingSDK());
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  // ── Public surface — the contract the refactor must not break ───────────────

  it('exposes the public API the auto-trip-detection refactor promises to preserve', () => {
    for (const method of [
      'startTrip', 'stopTrip', 'on', 'off', 'getStatus',
      'updateTargetDevice', 'getAvailableDevices', 'getBTSupportStatus',
      'simulateBluetoothConnection', 'simulateBluetoothDisconnection', 'debugAddDistance',
    ]) {
      expect(typeof (sdk as any)[method]).toBe('function');
    }
  });

  // ── Trip lifecycle ─────────────────────────────────────────────────────────

  it('starts a trip and reports it as active', async () => {
    const tripId = await sdk.startTrip();

    expect(tripId).toMatch(/^trip_\d+$/);
    expect(onTripStart).toHaveBeenCalledWith(tripId);
    expect(sdk.getStatus().isActive).toBe(true);
    expect(mockPhoneStart).toHaveBeenCalled();
  });

  it('refuses a second start instead of opening a parallel trip', async () => {
    await sdk.startTrip();
    onTripStart.mockClear();

    await expect(sdk.startTrip()).resolves.toBe('ALREADY_ACTIVE');
    expect(onTripStart).not.toHaveBeenCalled();
  });

  it('survives a validator that confirms the trip from inside start()', async () => {
    // DefaultTripValidator calls onTripConfirmed synchronously, which re-enters
    // startTrip while the first call is still on the stack. One trip must come out.
    await sdk.startTrip();

    expect(onTripStart).toHaveBeenCalledTimes(1);
    expect(tripData()?.events).toEqual([]);
  });

  it('returns the finished trip and clears the active one on stop', async () => {
    await startTripReady();
    const finished = await sdk.stopTrip();

    expect(finished).not.toBeNull();
    expect(finished?.endTime).toBeInstanceOf(Date);
    expect(onTripEnd).toHaveBeenCalledWith(finished);
    expect(sdk.getStatus().isActive).toBe(false);
    expect(tripData()).toBeNull();
    expect(mockSensorStop).toHaveBeenCalled();
    expect(mockPhoneStop).toHaveBeenCalled();
  });

  it('returns null when stopping with no trip in progress', async () => {
    await expect(sdk.stopTrip()).resolves.toBeNull();
    expect(onTripEnd).not.toHaveBeenCalled();
  });

  it('tracks duration from the wall clock, not from the tick count', async () => {
    await sdk.startTrip();
    jest.advanceTimersByTime(10_000);

    expect(tripData()?.durationSeconds).toBe(10);
  });

  it('stops the duration timer when the trip ends', async () => {
    await startTripReady();
    await sdk.stopTrip();
    onUpdate.mockClear();

    jest.advanceTimersByTime(5000);

    expect(onUpdate).not.toHaveBeenCalled();
  });

  // ── Warm-up grace window ───────────────────────────────────────────────────

  it('drops events fired within the warm-up window after start', async () => {
    await sdk.startTrip();
    jest.advanceTimersByTime(WARMUP_MS - 100);

    emitSensorEvent(DrivingEventType.HARD_BRAKE);

    expect(tripData()?.events).toHaveLength(0);
    expect(onEventDetected).not.toHaveBeenCalled();
  });

  it('accepts events once the warm-up window has passed', async () => {
    await startTripReady();

    emitSensorEvent(DrivingEventType.HARD_BRAKE);

    expect(tripData()?.events).toHaveLength(1);
    expect(onEventDetected).toHaveBeenCalledTimes(1);
  });

  it('ignores events arriving while no trip is active', () => {
    emitSensorEvent(DrivingEventType.HARD_BRAKE);

    expect(onEventDetected).not.toHaveBeenCalled();
  });

  // ── Per-type cooldown ──────────────────────────────────────────────────────

  it('suppresses a repeat of the same event type inside the cooldown', async () => {
    await startTripReady();

    emitSensorEvent(DrivingEventType.HARD_BRAKE, { atMs: 0 });
    emitSensorEvent(DrivingEventType.HARD_BRAKE, { atMs: 3000 });

    expect(tripData()?.events).toHaveLength(1);
  });

  it('accepts the same event type again once the cooldown has elapsed', async () => {
    await startTripReady();

    emitSensorEvent(DrivingEventType.HARD_BRAKE, { atMs: 0 });
    emitSensorEvent(DrivingEventType.HARD_BRAKE, { atMs: 5100 });

    expect(tripData()?.events).toHaveLength(2);
  });

  it('keeps the cooldown per type — a brake must not swallow a concurrent turn', async () => {
    await startTripReady();

    emitSensorEvent(DrivingEventType.HARD_BRAKE, { atMs: 0 });
    emitSensorEvent(DrivingEventType.SHARP_TURN, { atMs: 0 });

    expect(tripData()?.events.map((e) => e.type)).toEqual([
      DrivingEventType.HARD_BRAKE,
      DrivingEventType.SHARP_TURN,
    ]);
  });

  it('exempts phone usage from the cooldown', async () => {
    await startTripReady();

    mockPhoneEmit?.({ type: DrivingEventType.PHONE_USAGE, timestamp: new Date(), severity: 0.5 });
    mockPhoneEmit?.({ type: DrivingEventType.PHONE_USAGE, timestamp: new Date(), severity: 0.5 });

    expect(tripData()?.events).toHaveLength(2);
  });

  // ── Conditional listener dispatch ──────────────────────────────────────────

  it('delivers an event to a listener registered for that type', async () => {
    const handler = jest.fn();
    sdk.on(DrivingEventType.HARD_BRAKE, {}, handler);
    await startTripReady();

    emitSensorEvent(DrivingEventType.HARD_BRAKE);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].type).toBe(DrivingEventType.HARD_BRAKE);
  });

  it('does not deliver an event to a listener registered for another type', async () => {
    const handler = jest.fn();
    sdk.on(DrivingEventType.SHARP_TURN, {}, handler);
    await startTripReady();

    emitSensorEvent(DrivingEventType.HARD_BRAKE);

    expect(handler).not.toHaveBeenCalled();
  });

  it('holds a listener back below its minimum speed and releases it above', async () => {
    const handler = jest.fn();
    sdk.on(DrivingEventType.HARD_BRAKE, { minSpeedKmh: 15 }, handler);
    await startTripReady();

    sendSensorUpdate({ currentSpeed: 10 });
    emitSensorEvent(DrivingEventType.HARD_BRAKE, { atMs: 0 });
    expect(handler).not.toHaveBeenCalled();

    // Past the cooldown, which is applied before the speed gate — the suppressed
    // event above still stamped the type.
    sendSensorUpdate({ currentSpeed: 20 });
    emitSensorEvent(DrivingEventType.HARD_BRAKE, { atMs: 5100 });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  // severity only exists on PHONE_USAGE since CAR-156 — minSeverity is exercised
  // against that type now, not a motion event.
  it('holds a listener back below its minimum severity', async () => {
    const handler = jest.fn();
    sdk.on(DrivingEventType.PHONE_USAGE, { minSeverity: 0.8 }, handler);
    await startTripReady();

    mockPhoneEmit?.({ type: DrivingEventType.PHONE_USAGE, timestamp: new Date(), severity: 0.3 });
    expect(handler).not.toHaveBeenCalled();

    mockPhoneEmit?.({ type: DrivingEventType.PHONE_USAGE, timestamp: new Date(), severity: 0.9 });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not gate a motion event on minSeverity — motion events carry no severity (CAR-156)', async () => {
    const handler = jest.fn();
    sdk.on(DrivingEventType.HARD_BRAKE, { minSeverity: 0.8 }, handler);
    await startTripReady();

    emitSensorEvent(DrivingEventType.HARD_BRAKE, { atMs: 0 });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('still records a condition-filtered event on the trip', async () => {
    // Conditions decide who gets told, not what happened. The event is still part
    // of the trip — route markers and raw display depend on that.
    sdk.on(DrivingEventType.HARD_BRAKE, { minSpeedKmh: 50 }, jest.fn());
    await startTripReady();

    sendSensorUpdate({ currentSpeed: 10 });
    emitSensorEvent(DrivingEventType.HARD_BRAKE);

    expect(tripData()?.events).toHaveLength(1);
    expect(onEventDetected).toHaveBeenCalledTimes(1);
  });

  it('stops delivering to a listener that has been removed', async () => {
    const handler = jest.fn();
    const token = sdk.on(DrivingEventType.HARD_BRAKE, {}, handler);
    sdk.off(token);
    await startTripReady();

    emitSensorEvent(DrivingEventType.HARD_BRAKE);

    expect(handler).not.toHaveBeenCalled();
  });

  it('isolates a throwing listener from the other subscribers', async () => {
    const thrower = jest.fn(() => { throw new Error('listener blew up'); });
    const healthy = jest.fn();
    sdk.on(DrivingEventType.HARD_BRAKE, {}, thrower);
    sdk.on(DrivingEventType.HARD_BRAKE, {}, healthy);
    await startTripReady();

    emitSensorEvent(DrivingEventType.HARD_BRAKE);

    expect(healthy).toHaveBeenCalledTimes(1);
    expect(onEventDetected).toHaveBeenCalledTimes(1);
  });

  it('stamps speed and location onto a dispatched event', async () => {
    const handler = jest.fn();
    sdk.on(DrivingEventType.HARD_BRAKE, {}, handler);
    await startTripReady();

    sendSensorUpdate({ currentSpeed: 42, lat: 32.0853, lng: 34.7818 });
    emitSensorEvent(DrivingEventType.HARD_BRAKE);

    expect(handler.mock.calls[0][0]).toMatchObject({
      speedKmh: 42,
      location: { latitude: 32.0853, longitude: 34.7818 },
    });
  });

  // ── Distance accumulation ──────────────────────────────────────────────────

  it('ignores GPS ticks below the 3 km/h gate', async () => {
    await startTripReady();

    sendSensorUpdate({ currentSpeed: 2, distanceKm: 0.5, timeDeltaS: 2 });

    expect(tripData()?.distanceKm).toBe(0);
  });

  it('accumulates distance once above the gate', async () => {
    await startTripReady();

    // 50 km/h over 2s allows up to ~0.0417 km — 0.02 km is well within it.
    sendSensorUpdate({ currentSpeed: 50, distanceKm: 0.02, timeDeltaS: 2 });

    expect(tripData()?.distanceKm).toBeCloseTo(0.02, 5);
  });

  it('caps a GPS jump at what the reported speed physically allows', async () => {
    await startTripReady();

    // A 1 km jump reported alongside 5 km/h over 2s — multipath, not travel.
    sendSensorUpdate({ currentSpeed: 5, distanceKm: 1, timeDeltaS: 2 });

    // (5 / 3600) * 2 * 1.5
    expect(tripData()?.distanceKm).toBeCloseTo(0.0041667, 6);
  });

  it('tracks peak speed even from ticks that contribute no distance', async () => {
    await startTripReady();

    sendSensorUpdate({ currentSpeed: 2, distanceKm: 0.5 });

    expect(tripData()?.maxSpeed).toBe(2);
  });

  // ── Waypoint downsampling ──────────────────────────────────────────────────

  it('appends a waypoint only once 2 GPS seconds have elapsed', async () => {
    await startTripReady();
    const moving = { currentSpeed: 50, distanceKm: 0.02, lat: 32.1, lng: 34.8 };

    sendSensorUpdate(moving);
    expect(tripData()?.waypoints).toHaveLength(1); // anchor point, recorded immediately

    jest.advanceTimersByTime(1000);
    sendSensorUpdate(moving);
    expect(tripData()?.waypoints).toHaveLength(1); // only 1s since anchor — not yet

    jest.advanceTimersByTime(1000);
    sendSensorUpdate(moving);
    expect(tripData()?.waypoints).toHaveLength(2); // 2s since anchor — lands
  });

  // The Android case the cadence exists for: fixes deferred under Doze arrive as a batch
  // in one JS turn, so arrival time barely moves across the whole window (CAR-178).
  it('thins a deferred batch on fix time, not on arrival time', async () => {
    await startTripReady();
    const moving = { currentSpeed: 50, distanceKm: 0.02, lat: 32.1, lng: 34.8 };
    const t0 = Date.now();

    [0, 2000, 4000, 6000].forEach(offset =>
      sendSensorUpdate({ ...moving, fixTs: t0 + offset }),
    );

    expect(tripData()?.waypoints).toHaveLength(4);
    expect(tripData()?.waypoints.map(w => w.ts)).toEqual([t0, t0 + 2000, t0 + 4000, t0 + 6000]);
  });

  // Scope: the waypoint anchor only. SensorManager is mocked here, so a stepped fix
  // reaches this handler by construction — that it reaches it in the app is pinned by
  // the re-anchor test in SensorManager's own suite, which drives the real GPS path.
  it('re-anchors instead of stalling when the fix clock steps forward', async () => {
    await startTripReady();
    const moving = { currentSpeed: 50, distanceKm: 0.02, lat: 32.1, lng: 34.8 };
    const t0 = Date.now();

    sendSensorUpdate({ ...moving, fixTs: t0 });
    sendSensorUpdate({ ...moving, fixTs: t0 + 3_600_000 }); // NTP step: an hour forward
    sendSensorUpdate({ ...moving, fixTs: t0 + 2000 });      // back on the real clock

    // Without the negative-gap branch the anchor stays an hour ahead and this is 2.
    expect(tripData()?.waypoints).toHaveLength(3);
  });

  it('collects no waypoints while stationary', async () => {
    await startTripReady();

    for (let i = 0; i < 10; i++) {
      sendSensorUpdate({ currentSpeed: 1, lat: 32.1, lng: 34.8 });
    }

    expect(tripData()?.waypoints).toHaveLength(0);
  });

  // ── Trip end trimming (CAR-298) ────────────────────────────────────────────
  // Rule 2 only reports an end after 3 continuous minutes below its stop threshold, and
  // nothing is recorded in them. Leaving those minutes inside the duration is what pushed
  // `covered_s / duration` under the server's 0.5 coverage gate on every short trip.

  it('ends the trip at the last waypoint, not when stop detection finished', async () => {
    const startedAt = Date.now();
    await startTripReady();
    const moving = { currentSpeed: 50, distanceKm: 0.02, lat: 32.1, lng: 34.8 };

    sendSensorUpdate(moving);
    jest.advanceTimersByTime(60_000);
    sendSensorUpdate(moving);
    const lastMovedAt = Date.now();

    // The stop-detection tail: three minutes under the waypoint gate, so no trace.
    for (let i = 0; i < 180; i++) {
      jest.advanceTimersByTime(1000);
      sendSensorUpdate({ currentSpeed: 0, lat: 32.1, lng: 34.8 });
    }
    const finished = await sdk.stopTrip();

    expect(finished?.endTime?.getTime()).toBe(lastMovedAt);
    expect(finished?.durationSeconds).toBe(Math.floor((lastMovedAt - startedAt) / 1000));
  });

  it('reports a zero duration for a trip that never moved', async () => {
    await startTripReady();

    jest.advanceTimersByTime(180_000);
    const finished = await sdk.stopTrip();

    expect(finished?.durationSeconds).toBe(0);
    expect(finished?.averageSpeed).toBe(0);
  });

  // ── Vehicle key (CAR-310) ──────────────────────────────────────────────────

  it('stamps the connected vehicle as an opaque key, never the address itself', async () => {
    mockConnectedVehicleId = 'AA:BB:CC:DD:EE:FF';
    const hasher = jest.fn(() => 'deadbeefdeadbeefdeadbeefdeadbeef');
    const withHasher = wire(new DrivingSDK({ vehicleKeyHasher: hasher }));

    await startTripReady(withHasher);

    expect(hasher).toHaveBeenCalledWith('AA:BB:CC:DD:EE:FF');
    expect(tripData(withHasher)?.vehicleKeyHash).toBe('deadbeefdeadbeefdeadbeefdeadbeef');
  });

  it('leaves the vehicle key null when nothing is connected', async () => {
    const hasher = jest.fn(() => 'deadbeef');
    const withHasher = wire(new DrivingSDK({ vehicleKeyHasher: hasher }));

    await startTripReady(withHasher);

    expect(hasher).not.toHaveBeenCalled();
    expect(tripData(withHasher)?.vehicleKeyHash).toBeNull();
  });

  it('leaves the vehicle key null when the host injected no hasher', async () => {
    mockConnectedVehicleId = 'AA:BB:CC:DD:EE:FF';

    await startTripReady();

    expect(tripData()?.vehicleKeyHash).toBeNull();
  });

  // The binding is an extra; the trip is the product. A hasher that throws must not take
  // the drive down with it.
  it('saves the trip without a vehicle key when the hasher throws', async () => {
    mockConnectedVehicleId = 'AA:BB:CC:DD:EE:FF';
    const withHasher = wire(new DrivingSDK({
      vehicleKeyHasher: () => { throw new Error('no salt'); },
    }));

    await startTripReady(withHasher);

    expect(withHasher.getStatus().isActive).toBe(true);
    expect(tripData(withHasher)?.vehicleKeyHash).toBeNull();
  });

  // ── Phone interaction metrics ──────────────────────────────────────────────

  it('accumulates phone interaction metrics onto the trip (per-tick deltas, CAR-175)', async () => {
    await startTripReady();

    mockPhoneInteraction?.({ screenInteractionSeconds: 1, phoneMotionSeconds: 0, speedKmh: 40 });
    mockPhoneInteraction?.({ screenInteractionSeconds: 0, phoneMotionSeconds: 1, speedKmh: 42 });
    mockPhoneInteraction?.({ screenInteractionSeconds: 1, phoneMotionSeconds: 0, speedKmh: 42 });

    expect(tripData()).toMatchObject({ screenInteractionSeconds: 2, phoneMotionSeconds: 1 });
  });

  it('passes each per-second sample to the host with its speed, ungated (CAR-184)', async () => {
    const received: { screenInteractionSeconds: number; speedKmh: number }[] = [];
    sdk.onInteractionData = (data) => received.push(data);
    await startTripReady();

    mockPhoneInteraction?.({ screenInteractionSeconds: 1, phoneMotionSeconds: 0, speedKmh: 3 });
    mockPhoneInteraction?.({ screenInteractionSeconds: 1, phoneMotionSeconds: 0, speedKmh: 40 });

    expect(received).toMatchObject([
      { screenInteractionSeconds: 1, speedKmh: 3 },
      { screenInteractionSeconds: 1, speedKmh: 40 },
    ]);
  });

  it('carries accelerometer health onto the trip, not just the validator (CAR-189)', async () => {
    await startTripReady();

    sendSensorUpdate({ accelAvailable: false, accelInitFailed: true });

    expect(tripData()).toMatchObject({ accelAvailable: false, accelInitFailed: true });
  });

  it('keeps accelAvailable true once seen live, even if the sensor goes stale later (CAR-189)', async () => {
    await startTripReady();

    // SensorManager gates accelAvailable on sample freshness (CAR-161), so a healthy
    // accelerometer reports false after SENSOR_STALE_MS of silence. Ending the trip in
    // that window must not look like a phone with no accelerometer.
    sendSensorUpdate({ accelAvailable: true });
    sendSensorUpdate({ accelAvailable: false });

    expect(tripData()).toMatchObject({ accelAvailable: true, accelInitFailed: false });
  });

  // ── Delegation to the injected TripValidator ───────────────────────────────

  it('feeds every sensor sample to the injected validator, trip active or not', async () => {
    const validator = new StubValidator();
    const instance = wire(new DrivingSDK({ tripValidator: validator }));

    sendSensorUpdate({ currentSpeed: 30, yawRateRadS: 0.2, lateralAccelG: 1.1, longitudinalAccelG: -0.4 });

    expect(validator.samples).toHaveLength(1);
    expect(validator.samples[0]).toMatchObject({
      speedKmh: 30,
      yawRate: 0.2,
      lateralAccelG: 1.1,
      longitudinalAccelG: -0.4,
    });
    expect(instance.getStatus().isActive).toBe(false);
  });

  it('forwards a null longitudinal component before the forward direction is learned (CAR-319)', async () => {
    const validator = new StubValidator();
    wire(new DrivingSDK({ tripValidator: validator }));

    // The vehicle frame resolves both horizontal axes or neither, so an accelerometer
    // that is live but has not yet voted a forward direction reports null on both.
    // Null must survive the hop to the validator: 0 would claim a measured absence of
    // longitudinal force, which is a braking verdict nobody measured.
    sendSensorUpdate({ longitudinalAccelG: null, lateralAccelG: null, accelAvailable: true });

    expect(validator.samples[0]).toMatchObject({ longitudinalAccelG: null, lateralAccelG: null });
  });

  it('forwards sensor availability to the validator instead of a false zero (CAR-161)', async () => {
    const validator = new StubValidator();
    wire(new DrivingSDK({ tripValidator: validator }));

    sendSensorUpdate({ lateralAccelG: null, yawRateRadS: null, accelAvailable: false, gyroAvailable: false });

    expect(validator.samples[0]).toMatchObject({ accelAvailable: false, gyroAvailable: false });
  });

  it('forwards a denied background-location permission to the validator (CAR-16)', async () => {
    const validator = new StubValidator();
    wire(new DrivingSDK({ tripValidator: validator }));

    sendSensorUpdate({ backgroundLocationAvailable: false });

    expect(validator.samples[0]).toMatchObject({ backgroundLocationAvailable: false });
  });

  it('starts the trip when the validator confirms one', async () => {
    const validator = new StubValidator();
    wire(new DrivingSDK({ tripValidator: validator }));

    validator.onTripConfirmed?.();
    await flush();

    expect(onTripStart).toHaveBeenCalledTimes(1);
  });

  it('ends the trip when the validator says it ended', async () => {
    const validator = new StubValidator();
    const instance = wire(new DrivingSDK({ tripValidator: validator }));
    await startTripReady(instance);

    validator.onTripEnded?.();
    await flush();

    expect(onTripEnd).toHaveBeenCalledTimes(1);
    expect(instance.getStatus().isActive).toBe(false);
  });

  it('aborts a suspicious trip silently, without reporting it as completed', async () => {
    const validator = new StubValidator();
    const instance = wire(new DrivingSDK({ tripValidator: validator }));
    await startTripReady(instance);

    validator.onFraudSuspected?.(FRAUD);

    // onTripEnd is what persists a trip — a flagged session must not reach it.
    expect(onTripEnd).not.toHaveBeenCalled();
    expect(onFraudDetected).toHaveBeenCalledTimes(1);
    expect(onFraudDetected.mock.calls[0][0]).toMatchObject({
      fraudScore: FRAUD.score,
      detectedMode: 'TRAIN',
      signals: FRAUD.signals,
      // Read before the abort clears the trip data — zero, not undefined (CAR-134).
      distanceKm: 0,
    });
    expect(instance.getStatus().isActive).toBe(false);
    expect(instance.getStatus().tripData).toBeNull();
  });

  // The abort arrives from inside the validator, which cannot know the session is over.
  // Every other end route stops it; a validator left running holds whatever state it
  // reached, and the next session starts from there instead of from scratch.
  it('stops the validator on a fraud abort, like every other end route', async () => {
    const validator = new StubValidator();
    const instance = wire(new DrivingSDK({ tripValidator: validator }));
    await startTripReady(instance);

    validator.onFraudSuspected?.(FRAUD);

    expect(validator.stopped).toBe(1);
  });

  it('reports the peak speed seen during validation on the fraud payload', async () => {
    const validator = new StubValidator();
    wire(new DrivingSDK({ tripValidator: validator }));

    sendSensorUpdate({ currentSpeed: 90 });
    sendSensorUpdate({ currentSpeed: 40 });
    validator.onFraudSuspected?.(FRAUD);

    expect(onFraudDetected.mock.calls[0][0].maxSpeedKmh).toBe(90);
  });

  // The other half of the distance assertion above: caught at the pre-trip gate, no
  // trip was ever confirmed, so there is no distance to report. Not zero — unknown.
  it('omits the distance when the session is flagged before the trip is confirmed', async () => {
    const validator = new StubValidator();
    wire(new DrivingSDK({ tripValidator: validator }));

    validator.onFraudSuspected?.(FRAUD);

    expect(onFraudDetected.mock.calls[0][0].distanceKm).toBeUndefined();
  });

  // ── Auto-start seam ────────────────────────────────────────────────────────
  // Driven through the public trigger, not the Bluetooth-named private handlers:
  // the refactor replaces the trigger, not the behaviour asserted here.

  it('opens a validation session when an auto-start trigger fires', async () => {
    const validator = new StubValidator();
    const instance = wire(new DrivingSDK({ tripValidator: validator }));

    instance.simulateBluetoothConnection();
    await flush();

    expect(validator.started).toBe(1);
    expect(mockSensorStart).toHaveBeenCalled();
    expect(instance.getStatus().isValidating).toBe(true);
    // Validation is not a trip — the trip only starts once the validator confirms.
    expect(onTripStart).not.toHaveBeenCalled();
  });

  it('ignores the auto-start trigger when auto-start is switched off', async () => {
    const validator = new StubValidator();
    const instance = wire(
      new DrivingSDK({ tripValidator: validator, autoStartOnBluetooth: false }),
    );

    instance.simulateBluetoothConnection();
    await flush();

    expect(validator.started).toBe(0);
    expect(instance.getStatus().isValidating).toBe(false);
  });

  it('ignores a repeat trigger while a trip is already running', async () => {
    const validator = new StubValidator();
    const instance = wire(new DrivingSDK({ tripValidator: validator }));
    await startTripReady(instance);
    const startedBefore = validator.started;

    instance.simulateBluetoothConnection();
    await flush();

    expect(validator.started).toBe(startedBefore);
    expect(onTripStart).toHaveBeenCalledTimes(1);
  });

  it('tears down a validation session when the trigger is lost', async () => {
    const validator = new StubValidator();
    const instance = wire(new DrivingSDK({ tripValidator: validator }));
    instance.simulateBluetoothConnection();
    await flush();

    instance.simulateBluetoothDisconnection();
    await flush();

    expect(validator.stopped).toBeGreaterThan(0);
    expect(instance.getStatus().isValidating).toBe(false);
    expect(onTripEnd).not.toHaveBeenCalled();
  });

  it('ends a running trip when the trigger is lost', async () => {
    const validator = new StubValidator();
    const instance = wire(new DrivingSDK({ tripValidator: validator }));
    await startTripReady(instance);

    instance.simulateBluetoothDisconnection();
    await flush();

    expect(onTripEnd).toHaveBeenCalledTimes(1);
    expect(instance.getStatus().isActive).toBe(false);
  });

  // ── Target device wiring ───────────────────────────────────────────────────

  // Whether a target arms or disarms detection is the manager's rule, asserted in its own
  // suite. What belongs here is only that the SDK forwards what it was given, unchanged.
  it('forwards a target device to detection, and forwards clearing it too', () => {
    sdk.updateTargetDevice('AA:BB:CC:DD:EE:FF');
    expect(mockAutoEnable).toHaveBeenCalledWith('AA:BB:CC:DD:EE:FF');

    sdk.updateTargetDevice(null);
    expect(mockAutoEnable).toHaveBeenCalledWith(null);
  });

  it('arms detection from construction when a target device comes in through config', () => {
    jest.clearAllMocks();
    new DrivingSDK({ targetBluetoothId: 'AA:BB:CC:DD:EE:FF' });

    expect(mockAutoEnable).toHaveBeenCalledWith('AA:BB:CC:DD:EE:FF');
  });

  // ── Debug seam ─────────────────────────────────────────────────────────────

  it('adds debug distance only while a trip is running', async () => {
    sdk.debugAddDistance(5);
    expect(tripData()).toBeNull();

    await startTripReady();
    sdk.debugAddDistance(5);

    expect(tripData()?.distanceKm).toBe(5);
  });

  // ── Calibration recording (CAR-31) ────────────────────────────────────────
  // No real trip involved anywhere in this block — that's the point.

  it('starts sensors and the recorder, tagged with the caller-supplied labels', async () => {
    await sdk.startRawRecording('handheld', 'ios');

    expect(mockSensorStart).toHaveBeenCalledTimes(1);
    expect(mockRawStart).toHaveBeenCalledWith('handheld', 'ios', undefined);
  });

  it('taps the same accel/gyro subscriptions SensorManager already keeps powered', async () => {
    await sdk.startRawRecording('on-seat', 'android');

    mockAccelPassthrough?.({ x: 1, y: 2, z: 3 });
    mockGyroPassthrough?.({ x: 4, y: 5, z: 6 });

    expect(mockRawPushAccel).toHaveBeenCalledWith(1, 2, 3);
    expect(mockRawPushGyro).toHaveBeenCalledWith(4, 5, 6);
  });

  it('feeds the phone manager the gyroscope tap and nothing else', async () => {
    await sdk.startTrip();

    mockAccelPassthrough?.({ x: 1, y: 2, z: 3 });
    mockGyroPassthrough?.({ x: 4, y: 5, z: 6 });

    // One physical gyroscope, one listener: PhoneUsageManager reads it through the tap
    // rather than subscribing beside SensorManager (CAR-325).
    expect(mockPhonePushGyro).toHaveBeenCalledWith(4, 5, 6);
    // Acceleration is not an input to distraction detection since CAR-187 — a
    // single-sample force threshold cannot tell a finger from a pothole — so the
    // accelerometer tap must not reach the phone manager at all.
    expect(mockPhonePushAccel).not.toHaveBeenCalled();
  });

  it('records every GPS fix passed to handleSensorUpdate, unthinned', async () => {
    await sdk.startRawRecording('mounted', 'ios');
    sendSensorUpdate({ lat: 32.05, lng: 34.77, currentSpeed: 42, accuracy: 5 });

    expect(mockRawPushLocation).toHaveBeenCalledWith(32.05, 34.77, 42, 5);
  });

  it('stops the recorder and, with no trip active, stops sensors too', async () => {
    await sdk.startRawRecording('handheld', 'ios');
    await sdk.stopRawRecording();

    expect(mockRawStop).toHaveBeenCalledTimes(1);
    expect(mockSensorStop).toHaveBeenCalledTimes(1);
  });

  it('leaves sensors running on stopRawRecording if a real trip is active', async () => {
    await startTripReady();
    mockSensorStop.mockClear();

    await sdk.startRawRecording('handheld', 'ios');
    await sdk.stopRawRecording();

    expect(mockRawStop).toHaveBeenCalledTimes(1);
    expect(mockSensorStop).not.toHaveBeenCalled();
  });

  it('leaves sensors running on stopRawRecording if an auto-started trip is still validating (not yet active)', async () => {
    // Mirrors handleDriveDetected: isValidating can be true before isTripActive
    // flips. StubValidator never auto-confirms, so this pins that state — the default
    // validator confirms synchronously and would collapse straight to isTripActive.
    const validator = new StubValidator();
    const instance = wire(new DrivingSDK({ tripValidator: validator }));
    mockDetected?.();
    await flush();
    mockSensorStop.mockClear();

    await instance.startRawRecording('handheld', 'ios');
    await instance.stopRawRecording();

    expect(mockRawStop).toHaveBeenCalledTimes(1);
    expect(mockSensorStop).not.toHaveBeenCalled();
  });

  it('exports through the recorder', async () => {
    await sdk.exportRawRecording();
    expect(mockRawExport).toHaveBeenCalledTimes(1);
  });

  // Mirror image of the "leaves sensors running on stopRawRecording" tests above:
  // a raw-recording session outliving a trip that ends around it, not the other way.
  it('leaves sensors running on stopTrip if a raw-recording session is still active', async () => {
    await startTripReady();
    await sdk.startRawRecording('handheld', 'ios');
    mockSensorStop.mockClear();

    await sdk.stopTrip();

    expect(mockSensorStop).not.toHaveBeenCalled();
  });

  it('leaves sensors running when detection is lost mid-validation if a raw-recording session is still active', async () => {
    const validator = new StubValidator();
    const instance = wire(new DrivingSDK({ tripValidator: validator }));
    mockDetected?.();
    await flush();
    await instance.startRawRecording('handheld', 'ios');
    mockSensorStop.mockClear();

    mockLost?.();

    expect(mockSensorStop).not.toHaveBeenCalled();
  });

  it('leaves sensors running on a fraud abort if a raw-recording session is still active', async () => {
    const validator = new StubValidator();
    const instance = wire(new DrivingSDK({ tripValidator: validator }));
    await startTripReady(instance);
    await instance.startRawRecording('handheld', 'ios');
    mockSensorStop.mockClear();

    validator.onFraudSuspected?.(FRAUD);

    expect(mockSensorStop).not.toHaveBeenCalled();
  });
});
