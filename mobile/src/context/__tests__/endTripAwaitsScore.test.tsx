/**
 * `endTrip` must not resolve before the score does.
 *
 * The SDK's onTripEnd is a synchronous callback, so the promise the end-of-trip
 * processing returns was dropped and `stopTrip` resolved with the save still in
 * flight. Everything awaiting `endTrip` carried on early — the end-of-trip spinner
 * came down over a summary that had no score yet (CAR-301).
 */
import React from 'react'
import { Text } from 'react-native'
import { render, act } from '@testing-library/react-native'
import { AppProvider, useApp } from '@/context/AppContext'
import { tripsApi } from '@/services/api/trips.api'
import type { AppUser, Trip } from '@/types'

// The seams are the same as the other provider tests: storage, network, hardware and
// the sync queue are all touched on mount and none of them is what this is about.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
  multiSet: jest.fn().mockResolvedValue(undefined),
  multiRemove: jest.fn().mockResolvedValue(undefined),
}))

// Unlike the other provider tests, this one needs a working stopTrip: the whole point
// is that onTripEnd fires inside it, before it resolves. The `mock` prefix is
// load-bearing — jest.mock is hoisted above this declaration and its factory may only
// reach variables named that way.
type FakeSdk = {
  onUpdate?: (data: unknown) => void
  onTripEnd?: (data: unknown) => void
}
let mockSdk: FakeSdk

jest.mock('@/lib/driving-sdk', () => {
  const actual = jest.requireActual('@/lib/driving-sdk/types')
  return {
    ...actual,
    // The device probe now comes from the entry point, so the mocked package has to
    // supply it — mocking the deep DeviceCapabilities path would defeat CAR-334.
    checkDeviceCapabilities: jest.fn().mockResolvedValue({ hasAccelerometer: true, hasGyroscope: true, osSupported: true }),
    DrivingSDK: class {
      onTripStart?: (id: string) => void
      onUpdate?: (data: unknown) => void
      onTripEnd?: (data: unknown) => void
      constructor() { mockSdk = this }
      on() {}
      off() {}
      async startTrip() {}
      async stopTrip() {
        this.onTripEnd?.({ waypoints: [], events: [], durationSeconds: 600, distanceKm: 8.2 })
        return null
      }
    },
  }
})
jest.mock('@/lib/TripValidationManager', () => ({ TripValidationManager: class {} }))
jest.mock('@/lib/BatteryOptimizationPrompt', () => ({ maybePromptBatteryOptimizationExemption: jest.fn().mockResolvedValue(undefined) }))
jest.mock('expo-location', () => ({ requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }) }))
jest.mock('@/services/api/health.api', () => ({ pingServer: jest.fn().mockResolvedValue(true) }))
jest.mock('@/services/api/levels.api', () => ({ levelsApi: { list: jest.fn().mockResolvedValue({ levels: [] }) } }))
jest.mock('@/services/api/auth.api', () => ({ authApi: { me: jest.fn().mockResolvedValue({ id: 'u1' } as AppUser) } }))
jest.mock('@/services/api/trips.api', () => ({ tripsApi: { list: jest.fn(), save: jest.fn() } }))
jest.mock('@/services/api/user.api', () => ({ userApi: { stats: jest.fn().mockResolvedValue({ stats: {} }) } }))
jest.mock('@/services/sync/SyncManager', () => ({
  SyncManager: { flushQueue: jest.fn().mockResolvedValue(undefined), enqueue: jest.fn().mockResolvedValue(undefined), onTripSynced: null },
}))

/** A promise the test settles by hand, to hold the save in flight on purpose. */
function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function renderProvider() {
  const renders: ReturnType<typeof useApp>[] = []
  function Probe() {
    const ctx = useApp()
    renders.push(ctx)
    return <Text>{ctx.tripState.isActive ? 'driving' : 'idle'}</Text>
  }
  render(<AppProvider><Probe /></AppProvider>)
  return { latest: () => renders[renders.length - 1] }
}

const savedTrip = { id: 't1', userId: 'u1', avgScore: 91, points: 40 } as Trip

/**
 * Puts real distance on the trip in its own act.
 *
 * It cannot ride along with startTrip: the provider sets the trip state itself right
 * after the SDK call and that write wins. It cannot ride along with stopTrip either,
 * because the ref the end path reads is synced by an effect and would not see it yet.
 * Without the distance, the trip is judged too short and never reaches the save.
 */
const drive = () => act(async () => {
  mockSdk.onUpdate?.({ durationSeconds: 600, distanceKm: 8.2, touchEpochs: 0 })
})

beforeEach(() => {
  jest.clearAllMocks()
  ;(tripsApi.list as jest.Mock).mockResolvedValue({ trips: [] })
})

describe('endTrip', () => {
  it('waits for the score before it resolves', async () => {
    const save = deferred<Trip>()
    ;(tripsApi.save as jest.Mock).mockReturnValue(save.promise)

    const { latest } = renderProvider()
    await act(async () => { await latest().startTrip() })
    await drive()

    let resolved = false
    let ending!: Promise<unknown>
    await act(async () => {
      ending = latest().endTrip().then(v => { resolved = true; return v })
    })

    // The save is still in flight. Anything awaiting endTrip — the spinner included —
    // must still be waiting too.
    expect(tripsApi.save).toHaveBeenCalled()
    expect(resolved).toBe(false)

    await act(async () => {
      save.resolve(savedTrip)
      await ending
    })
    expect(resolved).toBe(true)
  })

  it('resolves on a failed save rather than leaving the caller hanging', async () => {
    // A spinner left up forever is worse than one that comes down with no score, so
    // the failure path has to settle too.
    ;(tripsApi.save as jest.Mock).mockRejectedValue(new Error('offline'))

    const { latest } = renderProvider()
    await act(async () => { await latest().startTrip() })
    await drive()
    await act(async () => { await latest().endTrip() })

    expect(tripsApi.save).toHaveBeenCalled()
  })
})
