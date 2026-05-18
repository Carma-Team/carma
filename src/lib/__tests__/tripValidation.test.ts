import { TripValidationManager } from '@/lib/driving-sdk/TripValidationManager';
import { ValidationState, TransportMode } from '@/lib/driving-sdk/types';

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

// ─── Rule 3: Train / Bus Detection ───────────────────────────────────────────

describe('Rule 3 — FraudDetector (train/bus detection)', () => {

  // Train profile: ~80 km/h constant, no lateral jolt, no yaw change
  // Scores all 3 signals (A+B+C = 1.0 ≥ 0.70 threshold)
  test('train-like motion blocks confirmation and fires onFraudSuspected', () => {
    const m = new TripValidationManager();
    const confirmed = jest.fn();
    const fraudSuspected = jest.fn();
    m.onTripConfirmed = confirmed;
    m.onFraudSuspected = fraudSuspected;
    m.start();

    // Speed alternates ±0.1 around 80 → variance ≈ 0.01 (far below 8 km/h² threshold)
    advanceFraudTicks(m, 30, 80, 0.01, () => 0.001); // accelX=0.01g, gyroZ=0.001 rad/s

    expect(confirmed).not.toHaveBeenCalled();
    expect(fraudSuspected).toHaveBeenCalledTimes(1);
    expect(fraudSuspected).toHaveBeenCalledWith(expect.any(Number), TransportMode.TRAIN);
    expect(m.getState()).toBe(ValidationState.IDLE);
    m.stop();
  });

  // Car profile: high speed variance + strong lateral forces + varying yaw
  // No signal reaches threshold → fraud score = 0 → trip confirms normally
  test('car-like motion (high variance + lateral forces) reaches SCORING', () => {
    const m = new TripValidationManager();
    const confirmed = jest.fn();
    const fraudSuspected = jest.fn();
    m.onTripConfirmed = confirmed;
    m.onFraudSuspected = fraudSuspected;
    m.start();

    // Cycle through varied speeds — variance ~376 >> 8 (Signal A fails)
    const speeds = [30, 80, 45, 90, 55, 70, 35, 80, 60, 75];
    for (let i = 0; i < 30; i++) {
      m.updateSample({
        speedKmh: speeds[i % speeds.length],
        timestamp: Date.now(),
        accel:   { x: 0.5, y: 0, z: 0 }, // 0.5g lateral >> 0.12g threshold (Signal B fails)
        gyroYaw: i % 2 === 0 ? 0.5 : -0.5, // alternating → variance = 0.25 >> 0.02 (Signal C fails)
      });
      jest.advanceTimersByTime(1000);
    }

    expect(m.getState()).toBe(ValidationState.SCORING);
    expect(confirmed).toHaveBeenCalledTimes(1);
    expect(fraudSuspected).not.toHaveBeenCalled();
    m.stop();
  });

  // Only Signal A fires (score = 0.40 < 0.70) — not enough to reject
  test('partial fraud signals (score < 0.70) do not block trip', () => {
    const m = new TripValidationManager();
    const confirmed = jest.fn();
    const fraudSuspected = jest.fn();
    m.onTripConfirmed = confirmed;
    m.onFraudSuspected = fraudSuspected;
    m.start();

    // Speed constant 80 → Signal A triggers (+0.40)
    // accelX = 0.5g → max > 0.12g → Signal B does NOT trigger
    // gyroZ alternates ±1 → variance = 1.0 >> 0.02 → Signal C does NOT trigger
    // Total = 0.40 < 0.70 → no fraud
    advanceFraudTicks(m, 30, 80, 0.5, (i) => (i % 2 === 0 ? 1 : -1));

    expect(m.getState()).toBe(ValidationState.SCORING);
    expect(confirmed).toHaveBeenCalledTimes(1);
    expect(fraudSuspected).not.toHaveBeenCalled();
    m.stop();
  });

  // Speed drop mid-PRE_TRIP flushes the fraud window; fresh 30 samples needed to re-trigger
  test('fraud window resets after speed drop — requires 30 fresh samples', () => {
    const m = new TripValidationManager();
    const confirmed = jest.fn();
    const fraudSuspected = jest.fn();
    m.onTripConfirmed = confirmed;
    m.onFraudSuspected = fraudSuspected;
    m.start();

    // 20 ticks of train profile (not enough samples to evaluate — < 30)
    advanceFraudTicks(m, 20, 80, 0.01, () => 0.001);
    // Speed drops — PRE_TRIP resets, fraud window cleared
    m.updateSample({ speedKmh: 5, timestamp: Date.now() });
    jest.advanceTimersByTime(1000);
    expect(m.getState()).toBe(ValidationState.IDLE);

    // 30 fresh ticks of train profile from IDLE — should detect fraud at tick 30
    advanceFraudTicks(m, 30, 80, 0.01, () => 0.001);

    expect(fraudSuspected).toHaveBeenCalledTimes(1);
    expect(confirmed).not.toHaveBeenCalled();
    m.stop();
  });
});
