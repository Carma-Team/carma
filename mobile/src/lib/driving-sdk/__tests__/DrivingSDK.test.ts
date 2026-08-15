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
  TransportMode,
} from '@/lib/driving-sdk/types';

// ─── Mocks ────────────────────────────────────────────────────────────────────
// Names are `mock`-prefixed so they survive jest's factory hoisting under both
// the current ts-jest transform and babel (jest-expo).

let mockSensorEmit: ((event: DrivingEvent) => void) | null = null;
let mockSensorUpdate: ((update: SensorUpdate) => void) | null = null;
let mockPhoneEmit: ((event: DrivingEvent) => void) | null = null;
let mockPhoneInteraction:
  | ((data: { touchEpochs: number; screenInteractionSeconds: number }) => void)
  | null = null;
let mockBtConnect: (() => void) | null = null;
let mockBtDisconnect: (() => void) | null = null;

const mockSensorStart = jest.fn(async () => undefined);
const mockSensorStop = jest.fn();
const mockPhoneStart = jest.fn();
const mockPhoneStop = jest.fn();
const mockBtSetTarget = jest.fn();
const mockBtStartMonitoring = jest.fn();
const mockBtStopMonitoring = jest.fn();

jest.mock('@/lib/driving-sdk/sensors/SensorManager', () => ({
  SensorManager: class {
    constructor(onEvent: any, onUpdate: any) {
      mockSensorEmit = onEvent;
      mockSensorUpdate = onUpdate;
    }
    async start() { return mockSensorStart(); }
    stop() { return mockSensorStop(); }
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
    pushGyroSample() {}
  },
}));

jest.mock('@/lib/driving-sdk/BluetoothManager', () => ({
  BluetoothManager: class {
    constructor(onConnect: any, onDisconnect: any) {
      mockBtConnect = onConnect;
      mockBtDisconnect = onDisconnect;
    }
    setTargetDevice(id: string | null) { return mockBtSetTarget(id); }
    startMonitoring() { return mockBtStartMonitoring(); }
    stopMonitoring() { return mockBtStopMonitoring(); }
    async getBondedDevices() { return []; }
    async getBTSupportStatus() { return { supported: true }; }
    simulateConnect() { mockBtConnect?.(); }
    simulateDisconnect() { mockBtDisconnect?.(); }
  },
}));

import { DrivingSDK } from '@/lib/driving-sdk';

// ─── Fixtures & helpers ───────────────────────────────────────────────────────

type SensorUpdate = {
  distanceKm: number;
  currentSpeed: number;
  timeDeltaS: number;
  accelX: number;
  gyroZ: number;
  lat?: number;
  lng?: number;
};

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
  mode: TransportMode.TRAIN,
  telemetry: { avgSpeedKmh: 80, maxLateralAccelG: 0.02, yawVariance: 0.001 },
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
      accelX: 0,
      gyroZ: 0,
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
    mockPhoneEmit = null;
    mockPhoneInteraction = null;
    mockBtConnect = null;
    mockBtDisconnect = null;
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
    emitSensorEvent(DrivingEventType.HARD_BRAKE, { atMs: 200 });

    expect(tripData()?.events).toHaveLength(1);
  });

  it('accepts the same event type again once the cooldown has elapsed', async () => {
    await startTripReady();

    emitSensorEvent(DrivingEventType.HARD_BRAKE, { atMs: 0 });
    emitSensorEvent(DrivingEventType.HARD_BRAKE, { atMs: 600 });

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

    sendSensorUpdate({ currentSpeed: 20 });
    emitSensorEvent(DrivingEventType.HARD_BRAKE, { atMs: 600 });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('holds a listener back below its minimum severity', async () => {
    const handler = jest.fn();
    sdk.on(DrivingEventType.HARD_BRAKE, { minSeverity: 0.8 }, handler);
    await startTripReady();

    emitSensorEvent(DrivingEventType.HARD_BRAKE, { severity: 0.3, atMs: 0 });
    expect(handler).not.toHaveBeenCalled();

    emitSensorEvent(DrivingEventType.HARD_BRAKE, { severity: 0.9, atMs: 600 });
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

  it('appends a waypoint only once ~5 GPS seconds have elapsed', async () => {
    await startTripReady();
    const moving = { currentSpeed: 50, distanceKm: 0.02, lat: 32.1, lng: 34.8 };

    sendSensorUpdate(moving);
    sendSensorUpdate(moving);
    expect(tripData()?.waypoints).toHaveLength(0); // 4 s of GPS time

    sendSensorUpdate(moving);
    expect(tripData()?.waypoints).toHaveLength(1); // 6 s — first point lands
  });

  it('accumulates real elapsed GPS time rather than an assumed fixed 2s tick', async () => {
    await startTripReady();
    const moving = { currentSpeed: 50, distanceKm: 0.05, lat: 32.1, lng: 34.8, timeDeltaS: 3 };

    sendSensorUpdate(moving);
    expect(tripData()?.waypoints).toHaveLength(0); // 3 s of real GPS time

    sendSensorUpdate(moving);
    expect(tripData()?.waypoints).toHaveLength(1); // 6 s — lands on the 2nd tick, not a hardcoded 3rd
  });

  it('collects no waypoints while stationary', async () => {
    await startTripReady();

    for (let i = 0; i < 10; i++) {
      sendSensorUpdate({ currentSpeed: 1, lat: 32.1, lng: 34.8 });
    }

    expect(tripData()?.waypoints).toHaveLength(0);
  });

  // ── Phone interaction metrics ──────────────────────────────────────────────

  it('copies phone interaction metrics onto the trip', async () => {
    await startTripReady();

    mockPhoneInteraction?.({ touchEpochs: 7, screenInteractionSeconds: 31 });

    expect(tripData()).toMatchObject({ touchEpochs: 7, screenInteractionSeconds: 31 });
  });

  // ── Delegation to the injected TripValidator ───────────────────────────────

  it('feeds every sensor sample to the injected validator, trip active or not', async () => {
    const validator = new StubValidator();
    const instance = wire(new DrivingSDK({ tripValidator: validator }));

    sendSensorUpdate({ currentSpeed: 30, gyroZ: 0.2, accelX: 1.1 });

    expect(validator.samples).toHaveLength(1);
    expect(validator.samples[0]).toMatchObject({ speedKmh: 30, gyroYaw: 0.2 });
    expect(instance.getStatus().isActive).toBe(false);
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
      confidence: FRAUD.score,
      mode: TransportMode.TRAIN,
    });
    expect(instance.getStatus().isActive).toBe(false);
    expect(instance.getStatus().tripData).toBeNull();
  });

  it('reports the peak speed seen during validation on the fraud payload', async () => {
    const validator = new StubValidator();
    wire(new DrivingSDK({ tripValidator: validator }));

    sendSensorUpdate({ currentSpeed: 90 });
    sendSensorUpdate({ currentSpeed: 40 });
    validator.onFraudSuspected?.(FRAUD);

    expect(onFraudDetected.mock.calls[0][0].maxSpeedKmh).toBe(90);
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

  it('starts monitoring when a target device is set and stops when it is cleared', () => {
    sdk.updateTargetDevice('AA:BB:CC:DD:EE:FF');
    expect(mockBtSetTarget).toHaveBeenCalledWith('AA:BB:CC:DD:EE:FF');
    expect(mockBtStartMonitoring).toHaveBeenCalledTimes(1);

    sdk.updateTargetDevice(null);
    expect(mockBtStopMonitoring).toHaveBeenCalledTimes(1);
  });

  it('monitors from construction when a target device comes in through config', () => {
    jest.clearAllMocks();
    new DrivingSDK({ targetBluetoothId: 'AA:BB:CC:DD:EE:FF' });

    expect(mockBtSetTarget).toHaveBeenCalledWith('AA:BB:CC:DD:EE:FF');
    expect(mockBtStartMonitoring).toHaveBeenCalledTimes(1);
  });

  // ── Debug seam ─────────────────────────────────────────────────────────────

  it('adds debug distance only while a trip is running', async () => {
    sdk.debugAddDistance(5);
    expect(tripData()).toBeNull();

    await startTripReady();
    sdk.debugAddDistance(5);

    expect(tripData()?.distanceKm).toBe(5);
  });
});
