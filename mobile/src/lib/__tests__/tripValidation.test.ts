let mockRegionAllowed = true;
jest.mock('@/lib/regionCheck', () => ({
  isRegionAllowed: jest.fn(() => mockRegionAllowed),
}));

import { TripValidationManager } from '@/lib/TripValidationManager';
import { ValidationState, TransportMode } from '@/lib/driving-sdk/types';
import { isRegionAllowed } from '@/lib/regionCheck';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function advanceTicks(manager: TripValidationManager, ticks: number, speedKmh: number): void {
  for (let i = 0; i < ticks; i++) {
    manager.updateSample({ speedKmh, timestamp: Date.now() });
    jest.advanceTimersByTime(1000);
  }
}

// Provides full sensor data per tick — required for Rule 3 fraud signal evaluation.
// gyroZFn: optional per-tick yaw value; defaults to constant 0.
function advanceFraudTicks(
  manager: TripValidationManager,
  ticks: number,
  speedKmh: number,
  accelX: number,
  gyroZFn: (i: number) => number = () => 0
): void {
  for (let i = 0; i < ticks; i++) {
    manager.updateSample({
      speedKmh,
      timestamp: Date.now(),
      accel: { x: accelX, y: 0, z: 0 },
      gyroYaw: gyroZFn(i),
    });
    jest.advanceTimersByTime(1000);
  }
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.useFakeTimers();
  mockRegionAllowed = true;
  (isRegionAllowed as jest.Mock).mockClear();
});

afterEach(() => {
  jest.useRealTimers();
});

// ─── Rule 1: 30-second Start Threshold ───────────────────────────────────────

describe('Rule 1 — 30s start threshold', () => {

  test('stays IDLE when speed is 0', () => {
    const m = new TripValidationManager();
    m.start();
    advanceTicks(m, 60, 0);
    expect(m.getState()).toBe(ValidationState.IDLE);
    m.stop();
  });

  test('enters PRE_TRIP on first tick above 10 km/h', () => {
    const m = new TripValidationManager();
    m.start();
    m.updateSample({ speedKmh: 15, timestamp: Date.now() });
    jest.advanceTimersByTime(1000);
    expect(m.getState()).toBe(ValidationState.PRE_TRIP);
    m.stop();
  });

  test('reaches SCORING after exactly 30 ticks above threshold', () => {
    const m = new TripValidationManager();
    const confirmed = jest.fn();
    m.onTripConfirmed = confirmed;
    m.start();
    advanceTicks(m, 30, 50);
    expect(m.getState()).toBe(ValidationState.SCORING);
    expect(confirmed).toHaveBeenCalledTimes(1);
    m.stop();
  });

  test('does NOT reach SCORING after only 29 ticks', () => {
    const m = new TripValidationManager();
    const confirmed = jest.fn();
    m.onTripConfirmed = confirmed;
    m.start();
    advanceTicks(m, 29, 50);
    expect(m.getState()).toBe(ValidationState.PRE_TRIP);
    expect(confirmed).not.toHaveBeenCalled();
    m.stop();
  });

  test('resets to IDLE if speed drops during PRE_TRIP window', () => {
    const m = new TripValidationManager();
    m.start();
    advanceTicks(m, 20, 50); // 20s above — not enough
    advanceTicks(m, 1, 5);   // speed drops — reset
    expect(m.getState()).toBe(ValidationState.IDLE);
    m.stop();
  });

  test('restarts 30s count correctly after a mid-window reset', () => {
    const m = new TripValidationManager();
    const confirmed = jest.fn();
    m.onTripConfirmed = confirmed;
    m.start();
    advanceTicks(m, 15, 50); // 15s
    advanceTicks(m, 1, 0);   // drops — reset
    advanceTicks(m, 30, 50); // fresh 30s
    expect(m.getState()).toBe(ValidationState.SCORING);
    expect(confirmed).toHaveBeenCalledTimes(1);
    m.stop();
  });

  test('fires onStateChange on every transition', () => {
    const m = new TripValidationManager();
    const states: ValidationState[] = [];
    m.onStateChange = (s) => states.push(s);
    m.start();
    advanceTicks(m, 30, 50);
    expect(states).toEqual([ValidationState.PRE_TRIP, ValidationState.SCORING]);
    m.stop();
  });
});

// ─── Rule 2: 3-minute End Threshold ──────────────────────────────────────────

describe('Rule 2 — 3-minute end threshold', () => {

  function enterScoring(m: TripValidationManager) {
    m.start();
    advanceTicks(m, 30, 50);
    expect(m.getState()).toBe(ValidationState.SCORING);
  }

  test('ends trip after 180 ticks below threshold', () => {
    const m = new TripValidationManager();
    const ended = jest.fn();
    m.onTripEnded = ended;
    enterScoring(m);
    advanceTicks(m, 180, 5);
    expect(m.getState()).toBe(ValidationState.ENDED);
    expect(ended).toHaveBeenCalledTimes(1);
  });

  test('does NOT end trip after only 179 ticks', () => {
    const m = new TripValidationManager();
    const ended = jest.fn();
    m.onTripEnded = ended;
    enterScoring(m);
    advanceTicks(m, 179, 5);
    expect(m.getState()).toBe(ValidationState.SCORING);
    expect(ended).not.toHaveBeenCalled();
  });

  test('resets below-threshold counter when speed resumes', () => {
    const m = new TripValidationManager();
    const ended = jest.fn();
    m.onTripEnded = ended;
    enterScoring(m);
    advanceTicks(m, 100, 5);   // 100s below — not enough
    advanceTicks(m, 5, 50);    // brief movement — counter resets
    advanceTicks(m, 179, 5);   // 179s below — still not enough
    expect(m.getState()).toBe(ValidationState.SCORING);
    expect(ended).not.toHaveBeenCalled();
  });

  test('ends trip after resumed then sustained low speed', () => {
    const m = new TripValidationManager();
    const ended = jest.fn();
    m.onTripEnded = ended;
    enterScoring(m);
    advanceTicks(m, 100, 5);  // 100s below
    advanceTicks(m, 5, 50);   // resume — resets counter
    advanceTicks(m, 180, 5);  // fresh 180s below
    expect(m.getState()).toBe(ValidationState.ENDED);
    expect(ended).toHaveBeenCalledTimes(1);
  });

  test('stop() from SCORING state fires no callbacks', () => {
    const m = new TripValidationManager();
    const ended = jest.fn();
    m.onTripEnded = ended;
    enterScoring(m);
    m.stop();
    expect(ended).not.toHaveBeenCalled();
    expect(m.getState()).toBe(ValidationState.IDLE);
  });
});

// ─── Edge Cases ───────────────────────────────────────────────────────────────

describe('edge cases', () => {

  test('double start() is a no-op (guard against duplicate intervals)', () => {
    const m = new TripValidationManager();
    const confirmed = jest.fn();
    m.onTripConfirmed = confirmed;
    m.start();
    m.start(); // second call — should be ignored
    advanceTicks(m, 30, 50);
    expect(confirmed).toHaveBeenCalledTimes(1); // not 2
    m.stop();
  });

  test('speed exactly at threshold (10 km/h) does not trigger Rule 1', () => {
    const m = new TripValidationManager();
    m.start();
    // Rule 1 requires strictly > 10 km/h
    advanceTicks(m, 30, 10);
    expect(m.getState()).toBe(ValidationState.IDLE);
    m.stop();
  });

  test('getDebugSnapshot returns correct state', () => {
    const m = new TripValidationManager();
    m.start();
    advanceTicks(m, 15, 50);
    const snap = m.getDebugSnapshot();
    expect(snap.state).toBe(ValidationState.PRE_TRIP);
    expect(snap.continuousAboveThresholdMs).toBe(15_000);
    m.stop();
  });
});

// ─── Rule 3: Transport-mode classification ───────────────────────────────────

describe('Rule 3 — FraudDetector (transport-mode classification)', () => {

  // The fixture that used to prove rejection now proves the opposite. These numbers are
  // a car at a steady 80 km/h with the phone upright in a vent clip — the mounting turns
  // real cornering force off the phone's X axis and real yaw off its Z — and they are
  // identical to the train profile. Signals 2 and 3 cannot separate the two from device
  // axes, so they report UNKNOWN and the trip is confirmed (CAR-167).
  test('a vent-clipped car on a motorway is confirmed, not rejected as rail travel', () => {
    const m = new TripValidationManager();
    const confirmed = jest.fn();
    const fraudSuspected = jest.fn();
    m.onTripConfirmed = confirmed;
    m.onFraudSuspected = fraudSuspected;
    m.start();

    // Speed alternates ±0.1 around 80 → variance ≈ 0.01 (far below 8 km/h²)
    advanceFraudTicks(m, 30, 80, 0.01, () => 0.001); // accelX=0.01g, gyroZ=0.001 rad/s

    expect(m.getState()).toBe(ValidationState.SCORING);
    expect(confirmed).toHaveBeenCalledTimes(1);
    expect(fraudSuspected).not.toHaveBeenCalled();

    const { fraudEvaluation } = m.getDebugSnapshot();
    expect(fraudEvaluation.mode).toBe(TransportMode.UNKNOWN);
    expect(fraudEvaluation.confidence).toBeCloseTo(0.40); // only signal 1 is evidence
    m.stop();
  });

  // Car profile: high speed variance + strong lateral forces + varying yaw.
  // Signal 1 fails on its own, so the trip confirms whatever the other two would say.
  test('car-like motion (high variance + lateral forces) reaches SCORING', () => {
    const m = new TripValidationManager();
    const confirmed = jest.fn();
    const fraudSuspected = jest.fn();
    m.onTripConfirmed = confirmed;
    m.onFraudSuspected = fraudSuspected;
    m.start();

    // Cycle through varied speeds — variance ~376 >> 8 (Signal 1 fails)
    const speeds = [30, 80, 45, 90, 55, 70, 35, 80, 60, 75];
    for (let i = 0; i < 30; i++) {
      m.updateSample({
        speedKmh: speeds[i % speeds.length],
        timestamp: Date.now(),
        accel:   { x: 0.5, y: 0, z: 0 },
        gyroYaw: i % 2 === 0 ? 0.5 : -0.5,
      });
      jest.advanceTimersByTime(1000);
    }

    expect(m.getState()).toBe(ValidationState.SCORING);
    expect(confirmed).toHaveBeenCalledTimes(1);
    expect(fraudSuspected).not.toHaveBeenCalled();
    m.stop();
  });

  // Signal 1 alone is 0.40, below the 0.70 threshold — and no other signal can raise it.
  test('signal 1 alone does not block a trip', () => {
    const m = new TripValidationManager();
    const confirmed = jest.fn();
    const fraudSuspected = jest.fn();
    m.onTripConfirmed = confirmed;
    m.onFraudSuspected = fraudSuspected;
    m.start();

    advanceFraudTicks(m, 30, 80, 0.5, (i) => (i % 2 === 0 ? 1 : -1));

    expect(m.getState()).toBe(ValidationState.SCORING);
    expect(confirmed).toHaveBeenCalledTimes(1);
    expect(fraudSuspected).not.toHaveBeenCalled();
    expect(m.getDebugSnapshot().fraudEvaluation.score).toBeCloseTo(0.40);
    m.stop();
  });

  // The highway false positive the old B+C requirement was written to catch. It is now
  // caught for a different reason — the score cannot reach 0.70 at all — which is why
  // this case stays: the outcome must survive the change in mechanism.
  test('a motorway car under cruise control is confirmed', () => {
    const m = new TripValidationManager();
    const confirmed = jest.fn();
    const fraudSuspected = jest.fn();
    m.onTripConfirmed = confirmed;
    m.onFraudSuspected = fraudSuspected;
    m.start();

    // Constant 80 km/h, smooth road, yaw alternating ±0.2 rad/s from micro-steering.
    advanceFraudTicks(m, 30, 80, 0.01, (i) => (i % 2 === 0 ? 0.2 : -0.2));

    expect(m.getState()).toBe(ValidationState.SCORING);
    expect(confirmed).toHaveBeenCalledTimes(1);
    expect(fraudSuspected).not.toHaveBeenCalled();
    m.stop();
  });

  // A speed drop mid-PRE_TRIP flushes the fraud window. No verdict is reachable to
  // observe that through, so it is read off the evaluation the manager exposes.
  test('fraud window resets after speed drop — requires 30 fresh samples', () => {
    const m = new TripValidationManager();
    m.start();

    advanceFraudTicks(m, 20, 80, 0.01, () => 0.001);
    m.updateSample({ speedKmh: 5, timestamp: Date.now() });
    jest.advanceTimersByTime(1000);
    expect(m.getState()).toBe(ValidationState.IDLE);

    // 29 fresh samples: still short of a verdict, which only holds if the 20 were dropped.
    advanceFraudTicks(m, 29, 80, 0.01, () => 0.001);
    expect(m.getDebugSnapshot().fraudEvaluation.isReady).toBe(false);

    advanceFraudTicks(m, 1, 80, 0.01, () => 0.001);
    expect(m.getDebugSnapshot().fraudEvaluation.isReady).toBe(true);
    expect(m.getState()).toBe(ValidationState.SCORING);
    m.stop();
  });
});

// ─── Rule 4: Region (CAR-23) ──────────────────────────────────────────────────

describe('Rule 4 — region check', () => {

  test('a fix outside the box rejects the trip and fires onRegionRejected', () => {
    mockRegionAllowed = false;
    const m = new TripValidationManager();
    const regionRejected = jest.fn();
    m.onRegionRejected = regionRejected;
    m.start();

    m.updateSample({ speedKmh: 50, timestamp: Date.now(), lat: 40, lng: -74 });

    expect(regionRejected).toHaveBeenCalledTimes(1);
    expect(m.getState()).toBe(ValidationState.IDLE);
    m.stop();
  });

  test('a fix inside the box does not reject the trip', () => {
    const m = new TripValidationManager();
    const regionRejected = jest.fn();
    m.onRegionRejected = regionRejected;
    m.start();

    advanceTicks(m, 30, 50); // reaches SCORING via Rule 1 — no lat/lng, region never checked
    m.updateSample({ speedKmh: 50, timestamp: Date.now(), lat: 32, lng: 34 });

    expect(regionRejected).not.toHaveBeenCalled();
    expect(m.getState()).toBe(ValidationState.SCORING);
    m.stop();
  });

  test('checks the region only once per trip, off the first fix', () => {
    const m = new TripValidationManager();
    m.start();

    m.updateSample({ speedKmh: 50, timestamp: Date.now(), lat: 32, lng: 34 });
    m.updateSample({ speedKmh: 50, timestamp: Date.now(), lat: 32, lng: 34 });
    m.updateSample({ speedKmh: 50, timestamp: Date.now(), lat: 32, lng: 34 });

    expect(isRegionAllowed).toHaveBeenCalledTimes(1);
    m.stop();
  });

  // Location permission denied: no sample ever carries a fix, so the gate never fires
  // and the trip scores normally. This is current behaviour, not a settled decision —
  // whether a fixless trip should instead be rejected is CAR-256.
  test('a trip that never carries a fix is never region-checked, and still confirms', () => {
    mockRegionAllowed = false; // would reject, if it were ever consulted
    const m = new TripValidationManager();
    const confirmed = jest.fn();
    const regionRejected = jest.fn();
    m.onTripConfirmed = confirmed;
    m.onRegionRejected = regionRejected;
    m.start();

    advanceTicks(m, 30, 50);

    expect(isRegionAllowed).not.toHaveBeenCalled();
    expect(regionRejected).not.toHaveBeenCalled();
    expect(confirmed).toHaveBeenCalledTimes(1);
    expect(m.getState()).toBe(ValidationState.SCORING);
    m.stop();
  });
});
