import React from 'react'
import { Text } from 'react-native'
import { render, act } from '@testing-library/react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { AppProvider, useApp } from '@/context/AppContext'
import type { AppUser } from '@/types'

// The provider reaches hardware, storage and the network on mount. None of that is
// involved in what these tests check, and all of it is absent under jest.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
  multiSet: jest.fn().mockResolvedValue(undefined),
  multiRemove: jest.fn().mockResolvedValue(undefined),
}))
// Only the class is replaced. The enums stay real: the provider's event bindings
// subscribe by `DrivingEventType.*`, and a bare object mock makes those undefined.
jest.mock('@/lib/driving-sdk', () => ({
  ...jest.requireActual('@/lib/driving-sdk/types'),
  DrivingSDK: class { on() {} off() {} },
}))
jest.mock('@/lib/TripValidationManager', () => ({ TripValidationManager: class {} }))
jest.mock('@/lib/BatteryOptimizationPrompt', () => ({ maybePromptBatteryOptimizationExemption: jest.fn() }))
jest.mock('@/services/api/health.api', () => ({ pingServer: jest.fn().mockResolvedValue(true) }))
jest.mock('@/services/api/levels.api', () => ({ levelsApi: { list: jest.fn().mockResolvedValue({ levels: [] }) } }))
jest.mock('@/services/api/auth.api', () => ({ authApi: { me: jest.fn() } }))
jest.mock('@/services/api/trips.api', () => ({ tripsApi: { list: jest.fn().mockResolvedValue({ trips: [] }), save: jest.fn() } }))
jest.mock('@/services/sync/SyncManager', () => ({
  SyncManager: { flushQueue: jest.fn().mockResolvedValue(undefined), onTripSynced: null },
}))

const DRIVER = { id: 'u1', name: 'Test', points: 100, driveModeEnabled: false } as AppUser

type Ctx = ReturnType<typeof useApp>

/**
 * Every render's context value is kept, so a test can hold the one a screen would
 * have closed over before an await and use it after the state moved on.
 */
function renderProvider() {
  const renders: Ctx[] = []
  function Probe() {
    const ctx = useApp()
    renders.push(ctx)
    return <Text>{ctx.user?.points ?? '-'}</Text>
  }
  render(<AppProvider><Probe /></AppProvider>)
  return { latest: () => renders[renders.length - 1] }
}

describe('patchUser under a concurrent user update', () => {
  beforeEach(() => jest.clearAllMocks())

  it('keeps a newer field that landed while the request was in flight', async () => {
    const { latest } = renderProvider()
    await act(async () => { await latest().setUser(DRIVER) })

    // What the settings screen holds when it fires the request.
    const beforeRequest = latest()

    // A trip finishes mid-request and credits the driver.
    await act(async () => { await latest().setUser({ ...DRIVER, points: 250 }) })

    // The request comes back and the toggle is applied from the stale handle.
    act(() => { beforeRequest.patchUser({ driveModeEnabled: true }) })

    expect(latest().user).toMatchObject({ points: 250, driveModeEnabled: true })
  })

  it('reads the current value when the patch is derived from it', async () => {
    const { latest } = renderProvider()
    await act(async () => { await latest().setUser(DRIVER) })

    const beforeRequest = latest()
    await act(async () => { await latest().setUser({ ...DRIVER, points: 250 }) })

    act(() => { beforeRequest.patchUser(prev => ({ points: (prev.points || 0) - 50 })) })

    expect(latest().user?.points).toBe(200)
  })

  it('persists the merged user, not the patch alone', async () => {
    const { latest } = renderProvider()
    await act(async () => { await latest().setUser(DRIVER) })

    act(() => { latest().patchUser({ driveModeEnabled: true }) })

    const written = (AsyncStorage.setItem as jest.Mock).mock.calls
      .filter(([key]) => key === 'carma_user')
      .pop()
    expect(JSON.parse(written[1])).toMatchObject({ points: 100, driveModeEnabled: true })
  })
})
