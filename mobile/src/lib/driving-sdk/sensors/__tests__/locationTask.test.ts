import type { LocationObject } from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import {
  DRIVING_SDK_LOCATION_TASK,
  setLocationHandler,
} from '@/lib/driving-sdk/sensors/locationTask';

// ─── Mocks ────────────────────────────────────────────────────────────────────
// defineTask runs at import time — the task body is registered before it can ever
// fire — so there is nothing to trigger and nothing to await. A bare jest.fn records
// the registration, and the tests read the body back out of it and invoke it the way
// TaskManager would. jest.mock() is hoisted above the imports above regardless of
// source position (babel-plugin-jest-hoist), which keeps eslint import/first happy.
jest.mock('expo-task-manager', () => ({ defineTask: jest.fn() }));

type TaskArg = { data?: { locations?: LocationObject[] }; error?: { message: string } | null };

// Captured once, at file scope: a later clearAllMocks() would wipe mock.calls and
// with it the only reference to the registered body.
const [registeredName, runTask] = (TaskManager.defineTask as jest.Mock).mock.calls[0] as [
  string,
  (arg: TaskArg) => Promise<void>,
];

const fixAt = (latitude: number, longitude: number): LocationObject =>
  ({
    coords: {
      latitude,
      longitude,
      altitude: 0,
      accuracy: 5,
      altitudeAccuracy: 5,
      heading: 0,
      speed: 0,
    },
    timestamp: 1_700_000_000_000,
  }) as LocationObject;

describe('locationTask', () => {
  let handler: jest.Mock;

  beforeEach(() => {
    handler = jest.fn();
    setLocationHandler(null);
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    setLocationHandler(null);
    jest.restoreAllMocks();
  });

  it('registers under the exported task name, which is what SensorManager starts and stops', () => {
    expect(registeredName).toBe(DRIVING_SDK_LOCATION_TASK);
  });

  it('forwards every fix in the batch, in arrival order, so distance counts each one', async () => {
    setLocationHandler(handler);
    const first = fixAt(32.05, 34.77);
    const second = fixAt(32.06, 34.78);

    await runTask({ data: { locations: [first, second] } });

    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler.mock.calls.map(([loc]) => loc)).toEqual([first, second]);
  });

  it('drops the batch on error rather than forwarding a partial or empty one', async () => {
    setLocationHandler(handler);

    await runTask({ error: { message: 'location services unavailable' } });

    expect(handler).not.toHaveBeenCalled();
  });

  it('survives a delivery with no handler registered, which is every fix that lands between trips', async () => {
    await expect(runTask({ data: { locations: [fixAt(32.05, 34.77)] } })).resolves.toBeUndefined();
  });

  it('stops forwarding once the handler is cleared, so a torn-down consumer is never called', async () => {
    setLocationHandler(handler);
    setLocationHandler(null);

    await runTask({ data: { locations: [fixAt(32.05, 34.77)] } });

    expect(handler).not.toHaveBeenCalled();
  });

  it('survives a delivery carrying no locations at all', async () => {
    setLocationHandler(handler);

    await runTask({ data: {} });
    await runTask({});

    expect(handler).not.toHaveBeenCalled();
  });
});
