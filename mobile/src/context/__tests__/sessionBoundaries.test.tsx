import React from 'react'
import { Text } from 'react-native'
import { render, act } from '@testing-library/react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { AppProvider, useApp } from '@/context/AppContext'
import { authApi } from '@/services/api/auth.api'
import { tripsApi } from '@/services/api/trips.api'
import { SyncManager } from '@/services/sync/SyncManager'
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

  it('shows only the signed-in driver rows when it falls back to the cache', async () => {
    ;(tripsApi.list as jest.Mock).mockRejectedValue(new Error('offline'))
    ;(AsyncStorage.getItem as jest.Mock).mockImplementation(async (key: string) =>
      key === 'carma_trips'
        ? JSON.stringify([tripOf('t1', 'u1'), tripOf('t2', 'u2')])
        : null
    )

    const { latest } = renderProvider()
    await act(async () => { await latest().loginUser({ token: 'tok', user: DRIVER_B }) })

    expect(latest().recentTrips.map(t => t.id)).toEqual(['t2'])
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
