import React from 'react'
import { Text } from 'react-native'
import { render, act } from '@testing-library/react-native'
import { AppProvider, useApp } from '@/context/AppContext'
import { getLevelByPoints } from '@/lib/constants'
import type { AppUser } from '@/types'
import type { TripState } from '@/context/tripState'

// The provider reaches hardware, storage and the network on mount, and none of it
// exists under jest. Same replacements as the other provider suite.
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
jest.mock('@/lib/BatteryOptimizationPrompt', () => ({ maybePromptBatteryOptimizationExemption: jest.fn().mockResolvedValue(undefined) }))
jest.mock('@/lib/telemetrySigning', () => ({ signTelemetryDigest: () => 'sig' }))
jest.mock('@/services/api/health.api', () => ({ pingServer: jest.fn().mockResolvedValue(true) }))
jest.mock('@/services/api/levels.api', () => ({ levelsApi: { list: jest.fn().mockResolvedValue({ levels: [] }) } }))
jest.mock('@/services/api/auth.api', () => ({ authApi: { me: jest.fn() } }))
jest.mock('@/services/api/trips.api', () => ({
  tripsApi: { list: jest.fn().mockResolvedValue({ trips: [] }), save: jest.fn() },
}))
jest.mock('@/services/sync/SyncManager', () => ({
  SyncManager: {
    flushQueue: jest.fn().mockResolvedValue(undefined),
    enqueue: jest.fn().mockResolvedValue(undefined),
    onTripSynced: null,
  },
}))

// The trip lifecycle is driven through the SDK bindings, so the binding hook is where
// the end-of-trip handler and the live trip state are reachable from a test.
let onTripEnded: (() => Promise<unknown>) | null = null
let tripRef: { current: TripState } | null = null
jest.mock('@/context/sdkBindings', () => ({
  useSdkBindings: (args: any) => {
    onTripEnded = args.onTripEnded
    tripRef = args.tripRef
  },
}))

const { tripsApi } = require('@/services/api/trips.api')

const DRIVER = { id: 'u1', name: 'Test', points: 100, totalPoints: 100, level: 1 } as AppUser

function renderProvider() {
  const renders: ReturnType<typeof useApp>[] = []
  function Probe() {
    const ctx = useApp()
    renders.push(ctx)
    return <Text>{ctx.user?.totalPoints ?? '-'}</Text>
  }
  render(<AppProvider><Probe /></AppProvider>)
  return { latest: () => renders[renders.length - 1] }
}

function activeTrip(): TripState {
  return {
    ...tripRef!.current,
    isActive: true,
    sessionId: 'trip_1',
    startTime: new Date('2026-09-01T08:00:00Z'),
    distanceKm: 12,
    durationSeconds: 900,
  }
}

describe('offline trip end — level and points come from the same totals (CAR-263)', () => {
  beforeEach(() => jest.clearAllMocks())

  it('does not pair a freshly credited total with a level from the older snapshot', async () => {
    const { latest } = renderProvider()
    await act(async () => { await latest().setUser(DRIVER) })

    // The save is left in flight so a user update can land underneath it, which is
    // the window the bug lived in — then it fails, taking the offline branch.
    let failSave!: (reason: Error) => void
    tripsApi.save.mockReturnValue(new Promise((_ok, reject) => { failSave = reject }))

    tripRef!.current = activeTrip()
    let ended!: Promise<unknown>
    await act(async () => { ended = onTripEnded!() })

    // A points award from somewhere else — a redemption refund, a server refresh —
    // lands while the trip is still being saved.
    await act(async () => { await latest().setUser({ ...DRIVER, points: 4000, totalPoints: 4000 }) })

    await act(async () => {
      failSave(new Error('offline'))
      await ended
    })

    const user = latest().user!
    expect(user.totalPoints).toBe(4000)
    expect(user.level).toBe(getLevelByPoints(user.totalPoints!))
  })

  it('shows the level the user actually carries', async () => {
    const { latest } = renderProvider()
    await act(async () => { await latest().setUser({ ...DRIVER, level: 4 }) })

    expect(latest().userLevelState.level).toBe(4)
  })
})
