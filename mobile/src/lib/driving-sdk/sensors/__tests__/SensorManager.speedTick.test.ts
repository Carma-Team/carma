/**
 * Speed-tick behaviour: the SDK-side timer that keeps the stale-speed decay running
 * when no GPS fix arrives (CAR-151), plus the iOS location options it ships with.
 *
 * Kept separate from the main SensorManager suite on purpose — that file lands in a
 * different PR, and sharing a path would have guaranteed a conflict.
 */
import * as Location from 'expo-location';

// ─── Mocks ────────────────────────────────────────────────────────────────────
jest.mock('expo-location', () => ({
  Accuracy: { High: 4 },
  ActivityType: { Other: 1, AutomotiveNavigation: 2 },
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestBackgroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  hasStartedLocationUpdatesAsync: jest.fn(async () => false),
  startLocationUpdatesAsync: jest.fn(async () => {}),
  stopLocationUpdatesAsync: jest.fn(async () => {}),
}));

jest.mock('expo-sensors', () => ({
  Accelerometer: {
    isAvailableAsync: jest.fn(async () => false),
    setUpdateInterval: jest.fn(),
    addListener: jest.fn(() => ({ remove: jest.fn() })),
  },
  Gyroscope: {
    isAvailableAsync: jest.fn(async () => false),
    setUpdateInterval: jest.fn(),
    addListener: jest.fn(() => ({ remove: jest.fn() })),
  },
}));

// Capture the handler SensorManager registers, so tests can deliver fixes directly.
let locationHandler: ((loc: any) => void) | null = null;

jest.mock('@/lib/driving-sdk/sensors/locationTask', () => ({
  DRIVING_SDK_LOCATION_TASK: 'driving-sdk-location-updates',
  setLocationHandler: jest.fn((fn: ((loc: any) => void) | null) => { locationHandler = fn; }),
}));

import { SensorManager } from '@/lib/driving-sdk/sensors/SensorManager';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STALE_SPEED_MS = 10_000;
const TICK_MS = 2_000;

/** A GPS fix at the current (faked) clock, carrying a valid Doppler speed. */
function fixAt(speedMs: number, lat = 32.08, lng = 34.78) {
  return {
    timestamp: Date.now(),
    coords: { latitude: lat, longitude: lng, speed: speedMs, heading: 90 },
  };
}

describe('SensorManager — speed tick', () => {
  let onEvent: jest.Mock;
  let onUpdate: jest.Mock;
  let manager: SensorManager;

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    locationHandler = null;
    onEvent = jest.fn();
    onUpdate = jest.fn();
    manager = new SensorManager(onEvent, onUpdate);
    await manager.start();
    onUpdate.mockClear(); // ignore anything emitted during start-up
  });

  afterEach(() => {
    manager.stop();
    jest.useRealTimers();
  });

  it('sets the automotive activity type on the location request', () => {
    expect(Location.startLocationUpdatesAsync).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ activityType: Location.ActivityType.AutomotiveNavigation }),
    );
  });

  it('stays silent while the last known speed is still fresh', () => {
    locationHandler?.(fixAt(20)); // 72 km/h
    onUpdate.mockClear();

    jest.advanceTimersByTime(STALE_SPEED_MS - TICK_MS);

    // Four ticks have fired and none of them had anything to report.
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('reports zero once the held speed goes stale, without a fix', () => {
    locationHandler?.(fixAt(20));
    onUpdate.mockClear();

    jest.advanceTimersByTime(STALE_SPEED_MS);

    expect(onUpdate).toHaveBeenCalled();
    expect(onUpdate.mock.calls[0][0]).toMatchObject({ currentSpeed: 0, distanceKm: 0 });
  });

  it('never carries coordinates — a tick must not be able to seed a waypoint', () => {
    locationHandler?.(fixAt(20));
    onUpdate.mockClear();

    jest.advanceTimersByTime(STALE_SPEED_MS);

    const payload = onUpdate.mock.calls[0][0];
    expect(payload.lat).toBeUndefined();
    expect(payload.lng).toBeUndefined();
    // Distance is the other half of the same guarantee: nothing to accumulate.
    expect(payload.distanceKm).toBe(0);
  });

  it('goes quiet again when fixes resume', () => {
    jest.advanceTimersByTime(STALE_SPEED_MS); // parked — ticks are reporting 0
    onUpdate.mockClear();

    locationHandler?.(fixAt(15)); // moving again
    onUpdate.mockClear();

    jest.advanceTimersByTime(STALE_SPEED_MS - TICK_MS);

    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('stops ticking after stop()', () => {
    manager.stop();
    onUpdate.mockClear();

    jest.advanceTimersByTime(STALE_SPEED_MS * 2);

    expect(onUpdate).not.toHaveBeenCalled();
  });
});
