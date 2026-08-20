/**
 * updateUser — the single-field merge behind the drive-mode toggle (CAR-153).
 *
 * The two behaviours worth pinning are the ones that cost a bug each: it must
 * merge into the user as it is *now* rather than into a caller's copy, and it
 * must do nothing once the session is over — a save landing after logout used to
 * write the account back into storage the logout had just cleared.
 *
 * Everything the provider reaches for on mount is mocked: this is a test about
 * one callback, not about the app starting up.
 */
import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppProvider, useApp } from '@/context/AppContext';
import type { AppUser } from '@/types';

jest.mock('@react-native-async-storage/async-storage', () =>
  // jest hoists mock factories above the imports, so this one cannot be an import.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// Only the orchestrator is replaced. The enums stay real, because the provider's
// listeners key off them and a stubbed enum would silently register nothing.
jest.mock('@/lib/driving-sdk', () => ({
  ...jest.requireActual('@/lib/driving-sdk/types'),
  DrivingSDK: jest.fn().mockImplementation(() => ({
    on: jest.fn(() => Symbol('token')),
    off: jest.fn(),
    onTripStart: jest.fn(),
    onTripEnd: jest.fn(),
    onUpdate: jest.fn(),
    startTrip: jest.fn(),
    stopTrip: jest.fn(),
    updateTargetDevice: jest.fn(),
    simulateBluetoothConnection: jest.fn(),
    simulateBluetoothDisconnection: jest.fn(),
    debugAddDistance: jest.fn(),
  })),
}));
jest.mock('@/lib/BatteryOptimizationPrompt', () => ({ maybePromptBatteryOptimizationExemption: jest.fn() }));
jest.mock('@/services/api/trips.api', () => ({ tripsApi: { list: jest.fn().mockResolvedValue({ trips: [] }) } }));
jest.mock('@/services/api/auth.api', () => ({ authApi: { me: jest.fn().mockRejectedValue(new Error('offline')) } }));
jest.mock('@/services/api/levels.api', () => ({ levelsApi: { list: jest.fn().mockRejectedValue(new Error('offline')) } }));
jest.mock('@/services/api/health.api', () => ({ pingServer: jest.fn().mockResolvedValue(true) }));
jest.mock('@/services/sync/SyncManager', () => ({
  SyncManager: {
    flushQueue: jest.fn().mockResolvedValue(undefined),
    enqueue: jest.fn().mockResolvedValue(undefined),
    onTripSynced: jest.fn(),
  },
}));

const DRIVER = {
  id: 'driver-1',
  name: 'Test Driver',
  role: 'DRIVER',
  language: 'HE',
  points: 100,
  totalPoints: 100,
  totalDistance: 12,
  level: 2,
  isPrivate: false,
  driveModeEnabled: false,
  createdAt: '2026-01-01T00:00:00Z',
} as unknown as AppUser;

const OTHER_DRIVER = { ...DRIVER, id: 'driver-2', name: 'Second Driver' } as AppUser;

const wrapper = ({ children }: { children: React.ReactNode }) => <AppProvider>{children}</AppProvider>;

beforeEach(() => {
  jest.clearAllMocks();
  AsyncStorage.clear();
});

test('it merges the patch into the signed-in user and persists the result', async () => {
  const { result } = renderHook(() => useApp(), { wrapper });

  await act(async () => {
    await result.current.setUser(DRIVER);
  });
  await act(async () => {
    await result.current.updateUser({ driveModeEnabled: true });
  });

  expect(result.current.user?.driveModeEnabled).toBe(true);
  // Untouched fields survive — the patch is a merge, not a replacement.
  expect(result.current.user?.points).toBe(100);

  const cached = JSON.parse((await AsyncStorage.getItem('carma_user')) as string);
  expect(cached.driveModeEnabled).toBe(true);
  expect(cached.name).toBe('Test Driver');
});

test('a save that lands after logout writes nothing', async () => {
  const { result } = renderHook(() => useApp(), { wrapper });

  await act(async () => {
    await result.current.setUser(DRIVER);
  });
  await act(async () => {
    await result.current.setUser(null);
  });

  await act(async () => {
    await result.current.updateUser({ driveModeEnabled: true });
  });

  await waitFor(() => expect(result.current.user).toBeNull());
  // The logout cleared this key. Writing it back would leave an account signed in
  // with no token behind it.
  expect(await AsyncStorage.getItem('carma_user')).toBeNull();
});

test('a save for one driver does not land on the next one to sign in', async () => {
  const { result } = renderHook(() => useApp(), { wrapper });

  await act(async () => {
    await result.current.setUser(DRIVER);
  });
  await act(async () => {
    await result.current.setUser(null);
    await result.current.setUser(OTHER_DRIVER);
  });

  // Driver 1's toggle finally comes back, on a handset driver 2 is now holding.
  await act(async () => {
    await result.current.updateUser({ driveModeEnabled: true }, DRIVER.id);
  });

  expect(result.current.user?.id).toBe('driver-2');
  expect(result.current.user?.driveModeEnabled).toBe(false);
});

test('two patches in a row compose instead of overwriting each other', async () => {
  const { result } = renderHook(() => useApp(), { wrapper });

  await act(async () => {
    await result.current.setUser(DRIVER);
  });
  await act(async () => {
    await result.current.updateUser({ driveModeEnabled: true });
    await result.current.updateUser({ city: 'חיפה' });
  });

  expect(result.current.user?.driveModeEnabled).toBe(true);
  expect(result.current.user?.city).toBe('חיפה');
});
