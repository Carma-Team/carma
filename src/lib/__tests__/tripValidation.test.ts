import { TripValidationManager } from '@/lib/driving-sdk/TripValidationManager';
import { ValidationState } from '@/lib/driving-sdk/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function advanceTicks(manager: TripValidationManager, ticks: number, speedKmh: number): void {
  for (let i = 0; i < ticks; i++) {
    manager.updateSample({ speedKmh, timestamp: Date.now() });
    // Trigger the private tick via Jest fake timers advancing 1s
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
