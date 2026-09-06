import React from 'react'
import { Text } from 'react-native'
import { render, act } from '@testing-library/react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { AppProvider, useApp } from '@/context/AppContext'
import { authApi } from '@/services/api/auth.api'
import { tripsApi } from '@/services/api/trips.api'
import { SyncManager } from '@/services/sync/SyncManager'
import { ApiError } from '@/services/api/client'
import type { AppUser, Trip } from '@/types'

// Same seams as patchUser.test.tsx: the provider reaches storage, network, hardware
// and the sync queue on mount, and none of that is what these tests are about.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
  multiSet: jest.fn().mockResolvedValue(undefined),
  multiRemove: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@/lib/driving-sdk', () => ({
  ...jest.requireActual('@/lib/driving-sdk/types'),
  // The device probe now comes from the entry point, so the mocked package has to
  // supply it — mocking the deep DeviceCapabilities path would defeat CAR-334.
  checkDeviceCapabilities: jest.fn().mockResolvedValue({ hasAccelerometer: true, hasGyroscope: true, osSupported: true }),
  DrivingSDK: class { on() {} off() {} },
}))
jest.mock('@/lib/TripValidationManager', () => ({ TripValidationManager: class {} }))
jest.mock('@/lib/BatteryOptimizationPrompt', () => ({ maybePromptBatteryOptimizationExemption: jest.fn() }))
jest.mock('expo-location', () => ({ requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }) }))
jest.mock('@/services/api/health.api', () => ({ pingServer: jest.fn().mockResolvedValue(true) }))
jest.mock('@/services/api/levels.api', () => ({ levelsApi: { list: jest.fn().mockResolvedValue({ levels: [] }) } }))
jest.mock('@/services/api/auth.api', () => ({ authApi: { me: jest.fn() } }))
jest.mock('@/services/api/trips.api', () => ({ tripsApi: { list: jest.fn(), save: jest.fn() } }))
jest.mock('@/services/sync/SyncManager', () => ({
  SyncManager: { flushQueue: jest.fn().mockResolvedValue(undefined), onTripSynced: null },
}))

const DRIVER_A = { id: 'u1', name: 'A', points: 100 } as AppUser
const DRIVER_B = { id: 'u2', name: 'B', points: 5 } as AppUser

const tripOf = (id: string, userId: string) =>
  ({ id, userId, startTime: '2026-01-01T00:00:00Z', avgScore: 90 } as Trip)

/** A promise the test resolves by hand, to hold a request in flight across a session change. */
function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const storedTrips = () =>
  (AsyncStorage.setItem as jest.Mock).mock.calls.filter(([key]) => key === 'carma_trips')

function renderProvider() {
  const renders: ReturnType<typeof useApp>[] = []
  function Probe() {
    const ctx = useApp()
    renders.push(ctx)
    return <Text>{ctx.user?.id ?? '-'}</Text>
  }
  render(<AppProvider><Probe /></AppProvider>)
  return { latest: () => renders[renders.length - 1] }
}

describe('AppContext session boundaries on a shared handset', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValue(null)
    // clearAllMocks drops calls, not implementations, and `storageOf` below replaces
    // these two — without this they stay replaced for every test after it.
    ;(AsyncStorage.removeItem as jest.Mock).mockResolvedValue(undefined)
    ;(AsyncStorage.multiRemove as jest.Mock).mockResolvedValue(undefined)
    ;(tripsApi.list as jest.Mock).mockResolvedValue({ trips: [] })
    ;(authApi.me as jest.Mock).mockResolvedValue(DRIVER_A)
  })

  // Bug 1 — an async update that resolves after the driver changed.
  it('drops the post-sync user refresh when another driver signed in meanwhile', async () => {
    const me = deferred<AppUser>()
    ;(authApi.me as jest.Mock).mockReturnValue(me.promise)

    const { latest } = renderProvider()
    await act(async () => { await latest().setUser(DRIVER_A) })

    // A queued trip of driver A syncs, and its totals refresh is still in flight.
    act(() => { SyncManager.onTripSynced!('local1', tripOf('t1', 'u1')) })
    await act(async () => { await latest().setUser(DRIVER_B) })
    await act(async () => { me.resolve({ ...DRIVER_A, points: 999 }); await me.promise })

    expect(latest().user).toMatchObject({ id: 'u2', points: 5 })
  })

  // Bug 2 — the login trip fetch outliving the session it was started for.
  it('drops the login trip fetch that resolves after logout', async () => {
    const list = deferred<{ trips: Trip[] }>()
    ;(tripsApi.list as jest.Mock).mockReturnValue(list.promise)

    const { latest } = renderProvider()
    let login!: Promise<void>
    await act(async () => { login = latest().loginUser({ token: 'tok', user: DRIVER_A }) })

    await act(async () => { await latest().setUser(null) })
    await act(async () => { list.resolve({ trips: [tripOf('t1', 'u1')] }); await login })

    expect(latest().recentTrips).toEqual([])
    expect(storedTrips()).toHaveLength(0)
  })

  // Bug 3 — the trip cache is part of the session.
  it('clears the cached trips on logout', async () => {
    const { latest } = renderProvider()
    await act(async () => { await latest().setUser(DRIVER_A) })
    await act(async () => { await latest().setUser(null) })

    expect(AsyncStorage.multiRemove).toHaveBeenCalledWith(
      expect.arrayContaining(['carma_trips'])
    )
  })

  // The cache is only worth reading when it is provably the signing-in driver's own,
  // so these two are a pair: drop the second and the first passes on a stub that never
  // deletes anything. A plain jest.fn() is that stub, hence the small store.
  function storageOf(entries: Record<string, string>) {
    const store: Record<string, string> = { ...entries }
    ;(AsyncStorage.getItem as jest.Mock).mockImplementation(async (k: string) => store[k] ?? null)
    ;(AsyncStorage.removeItem as jest.Mock).mockImplementation(async (k: string) => { delete store[k] })
    ;(AsyncStorage.multiRemove as jest.Mock).mockImplementation(async (keys: string[]) => {
      keys.forEach(k => { delete store[k] })
    })
  }

  it('drops the cached trips when a different driver signs in', async () => {
    ;(tripsApi.list as jest.Mock).mockRejectedValue(new Error('offline'))
    storageOf({
      carma_user: JSON.stringify(DRIVER_A),
      carma_trips: JSON.stringify([tripOf('t1', 'u1')]),
    })

    const { latest } = renderProvider()
    await act(async () => { await latest().loginUser({ token: 'tok', user: DRIVER_B }) })

    expect(latest().recentTrips).toEqual([])
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith('carma_trips')
  })

  it('keeps the cached trips when the same driver signs in again', async () => {
    ;(tripsApi.list as jest.Mock).mockRejectedValue(new Error('offline'))
    storageOf({
      carma_user: JSON.stringify(DRIVER_B),
      carma_trips: JSON.stringify([tripOf('t2', 'u2')]),
    })

    const { latest } = renderProvider()
    await act(async () => { await latest().loginUser({ token: 'tok', user: DRIVER_B }) })

    expect(latest().recentTrips.map(t => t.id)).toEqual(['t2'])
  })

  // Bug 5 — a server that never answered is not a server that rejected the token.
  it('keeps the stored session when the startup refresh fails on the network', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockImplementation(async (key: string) =>
      key === 'carma_user' ? JSON.stringify(DRIVER_A)
      : key === 'carma_token' ? 'tok'
      : key === 'carma_trips' ? JSON.stringify([tripOf('t1', 'u1')])
      : null
    )
    // Offline is both calls failing, not one — the trip fetch has to reach its own
    // fallback for this test to say anything about it.
    ;(authApi.me as jest.Mock).mockRejectedValue(new ApiError(408, 'Request timed out'))
    ;(tripsApi.list as jest.Mock).mockRejectedValue(new ApiError(408, 'Request timed out'))

    const { latest } = renderProvider()
    await act(async () => {})

    expect(latest().user).toMatchObject({ id: 'u1' })
    expect(latest().recentTrips.map(t => t.id)).toEqual(['t1'])
    expect(AsyncStorage.multiRemove).not.toHaveBeenCalled()
  })

  it('ends the session when the server rejects the stored token', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockImplementation(async (key: string) =>
      key === 'carma_user' ? JSON.stringify(DRIVER_A)
      : key === 'carma_token' ? 'tok'
      : null
    )
    ;(authApi.me as jest.Mock).mockRejectedValue(new ApiError(401, 'Unauthorized'))

    const { latest } = renderProvider()
    await act(async () => {})

    expect(latest().user).toBeNull()
    expect(AsyncStorage.multiRemove).toHaveBeenCalledWith(
      expect.arrayContaining(['carma_user', 'carma_token', 'carma_trips'])
    )
  })

  // Bug 4 — the post-sync refresh must not drop what only the device knows.
  it('keeps device-only fields through the post-sync user refresh', async () => {
    const { latest } = renderProvider()
    await act(async () => {
      await latest().setUser({ ...DRIVER_A, lastClearedHistory: '2026-02-01T00:00:00Z', country: 'IL' })
    })

    // The server has no column for either field, so its answer carries neither.
    ;(authApi.me as jest.Mock).mockResolvedValue({ id: 'u1', name: 'A', points: 140 } as AppUser)
    await act(async () => { SyncManager.onTripSynced!('local1', tripOf('t1', 'u1')) })

    expect(latest().user).toMatchObject({
      points: 140,
      lastClearedHistory: '2026-02-01T00:00:00Z',
      country: 'IL',
    })
    const written = (AsyncStorage.setItem as jest.Mock).mock.calls
      .filter(([key]) => key === 'carma_user').pop()
    expect(JSON.parse(written[1])).toMatchObject({ lastClearedHistory: '2026-02-01T00:00:00Z' })
  })
})
