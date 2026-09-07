import React from 'react'
import { Text } from 'react-native'
import { render, act } from '@testing-library/react-native'
import { AppProvider, useApp } from '@/context/AppContext'
import type { AppUser, Trip } from '@/types'

// A stateful storage mock, unlike the other provider suites: what is under test here is
// two writes landing on the same key, which a mock that answers null cannot show.
// `mock` prefix required: jest hoists the factory above this declaration.
const mockStore = new Map<string, string>()
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItem: jest.fn(async (k: string, v: string) => { mockStore.set(k, v) }),
  removeItem: jest.fn(async (k: string) => { mockStore.delete(k) }),
  multiSet: jest.fn(async (pairs: [string, string][]) => { pairs.forEach(([k, v]) => mockStore.set(k, v)) }),
  multiRemove: jest.fn(async (keys: string[]) => { keys.forEach(k => mockStore.delete(k)) }),
}))
jest.mock('@/lib/driving-sdk', () => ({
  ...jest.requireActual('@/lib/driving-sdk/types'),
  checkDeviceCapabilities: jest.fn().mockResolvedValue({ hasAccelerometer: true, hasGyroscope: true, osSupported: true }),
  DrivingSDK: class { on() {} off() {} },
}))
jest.mock('@/lib/TripValidationManager', () => ({ TripValidationManager: class {} }))
jest.mock('@/lib/BatteryOptimizationPrompt', () => ({ maybePromptBatteryOptimizationExemption: jest.fn().mockResolvedValue(undefined) }))
jest.mock('@/lib/telemetrySigning', () => ({ signTelemetryDigest: () => 'sig' }))
jest.mock('@/services/api/health.api', () => ({ pingServer: jest.fn().mockResolvedValue(true) }))
jest.mock('@/services/api/levels.api', () => ({ levelsApi: { list: jest.fn().mockResolvedValue({ levels: [] }) } }))
jest.mock('@/services/api/auth.api', () => ({ authApi: { me: jest.fn().mockRejectedValue(new Error('offline')) } }))
jest.mock('@/services/api/trips.api', () => ({
  tripsApi: { list: jest.fn().mockResolvedValue({ trips: [] }), save: jest.fn() },
}))
jest.mock('@/services/sync/SyncManager', () => ({
  SyncManager: {
    flushQueue: jest.fn().mockResolvedValue(undefined),
    enqueue: jest.fn().mockResolvedValue(undefined),
    onTripSynced: null,
    onTripAbandoned: null,
  },
}))
jest.mock('@/context/sdkBindings', () => ({ useSdkBindings: () => {} }))

const { SyncManager } = require('@/services/sync/SyncManager')
const { tripsApi } = require('@/services/api/trips.api')

const DRIVER = { id: 'u1', name: 'Test', points: 0, totalPoints: 0, level: 1 } as AppUser

const unsentTrip = (id: string, startTime: string): Trip => ({
  id, userId: 'u1', startTime, endTime: startTime,
  distanceKm: 5, durationSeconds: 600, avgScore: 0, points: 0,
  hardBrakes: 0, aggressiveAccels: 0, sharpTurns: 0, touchEpochs: 0,
  screenInteractionSeconds: 0, riskMultiplier: 1, effectiveRiskMultiplier: 1,
  status: 'completed', startLocation: null, endLocation: null, aiInsight: null,
  pointsCapped: false, pendingSync: true,
} as unknown as Trip)

/**
 * Mounts with a stored session, which is the path that refreshes the trip list — the
 * cold start where the refresh runs before the queue is flushed. `authApi.me` rejects
 * with a plain error, so the session is kept and the refresh still runs.
 */
async function renderSignedIn(trips: Trip[]) {
  mockStore.set('carma_user', JSON.stringify(DRIVER))
  mockStore.set('carma_token', 'tok')
  mockStore.set('carma_trips', JSON.stringify(trips))

  const renders: ReturnType<typeof useApp>[] = []
  function Probe() {
    const ctx = useApp()
    renders.push(ctx)
    return <Text>{ctx.recentTrips.length}</Text>
  }
  render(<AppProvider><Probe /></AppProvider>)
  // Separately, not around the render: the mount's own effects are what fetch the list.
  await act(async () => {})
  return { latest: () => renders[renders.length - 1] }
}

const cached = (): Trip[] => JSON.parse(mockStore.get('carma_trips') ?? '[]')

beforeEach(() => {
  mockStore.clear()
  jest.clearAllMocks()
  tripsApi.list.mockResolvedValue({ trips: [] })
})

describe('the trip cache survives what the server has not seen', () => {
  // The queue is flushed after the list refresh on a cold start, so a trip recorded
  // offline is not on the server when the refresh answers. Replacing the list wholesale
  // erased it there and then — before it had been retried once, and before either sync
  // outcome had a row left to write to.
  it('keeps an unsent trip the server does not know about', async () => {
    const scored = { ...unsentTrip('server_1', '2026-09-04T10:00:00Z'), pendingSync: undefined, avgScore: 90 }
    tripsApi.list.mockResolvedValue({ trips: [scored] })

    const { latest } = await renderSignedIn([unsentTrip('local_1', '2026-09-05T10:00:00Z')])

    expect(latest().recentTrips.map(t => t.id)).toEqual(['local_1', 'server_1'])
    expect(cached().map(t => t.id)).toEqual(['local_1', 'server_1'])
  })

  // A trip the server dropped is not kept alive by an old cache entry — only its own
  // sync state earns a row a place here.
  it('lets a scored trip the server no longer lists disappear', async () => {
    const gone = { ...unsentTrip('server_1', '2026-09-04T10:00:00Z'), pendingSync: undefined }

    const { latest } = await renderSignedIn([gone])

    expect(latest().recentTrips).toHaveLength(0)
  })

  // The age check abandons consecutive head items inside one synchronous pass, so both
  // callbacks fire before either read of the cache has resolved.
  it('marks both trips when two are abandoned in the same tick', async () => {
    tripsApi.list.mockRejectedValue(new Error('offline'))

    await renderSignedIn([
      unsentTrip('local_1', '2026-09-05T10:00:00Z'),
      unsentTrip('local_2', '2026-09-05T09:00:00Z'),
    ])

    await act(async () => {
      SyncManager.onTripAbandoned('local_1')
      await SyncManager.onTripAbandoned('local_2')
    })

    expect(cached().map(t => t.syncFailed)).toEqual([true, true])
  })
})
