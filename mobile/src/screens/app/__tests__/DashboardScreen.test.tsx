import React from 'react'
import { render, screen, act } from '@testing-library/react-native'
import DashboardScreen from '@/screens/app/DashboardScreen'
import { userApi } from '@/services/api/user.api'
import type { AppUser, DrivingStats } from '@/types'

// Replaced rather than provided: the real context boots the driving SDK and the API
// layer would reach the network. What is left under test is what the hero is told.
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0 }) }))
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useFocusEffect: jest.fn(),
}))
jest.mock('@/services/api/user.api', () => ({ userApi: { stats: jest.fn() } }))
jest.mock('@/services/api/friends.api', () => ({ friendsApi: { getIncoming: jest.fn() } }))
jest.mock('@/services/api/notifications.api', () => ({ notificationsApi: { list: jest.fn() } }))
// The trip screen takes over the whole surface while a trip runs; this suite never
// starts one, and rendering it would drag the SDK in.
jest.mock('@/screens/app/ActiveTripScreen', () => () => null)

// The number the server hands a driver with no measured trips: the fleet prior, not a
// score anyone earned. Showing it is the defect CAR-302 is about.
const FLEET_PRIOR = 75

const mockUser = {
  id: 'u1', name: 'May', driverScore: FLEET_PRIOR, totalDistance: 0,
  // The hero renders the level ladder beside the score, so the fields it reads have
  // to be real ones — this suite is about the score, not about tolerating a half user.
  level: 3, totalPoints: 1200, points: 1200, spentPoints: 0,
  // Through `unknown`: this is the handful of fields the dashboard reads, not a whole
  // AppUser, and spelling out twenty more would say nothing about what is under test.
} as unknown as AppUser

jest.mock('@/context/AppContext', () => ({
  useApp: () => ({
    user: mockUser,
    recentTrips: [],
    isLoading: false,
    tripState: { isActive: false },
    startTrip: jest.fn(),
    lastTripSummary: null,
    setLastTripSummary: jest.fn(),
  }),
}))

const mocked = userApi as jest.Mocked<typeof userApi>

async function renderDashboard() {
  render(<DashboardScreen />)
  // The two badge calls and the stats call all settle on the first tick.
  await act(async () => { await Promise.resolve() })
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'error').mockImplementation(() => {})
  ;(require('@/services/api/friends.api').friendsApi.getIncoming as jest.Mock)
    .mockResolvedValue({ requests: [] })
  ;(require('@/services/api/notifications.api').notificationsApi.list as jest.Mock)
    .mockResolvedValue([])
})

describe('DashboardScreen — the score after a failed stats call (CAR-302)', () => {
  it('shows the placeholder to a driver whose first stats call fails', async () => {
    mocked.stats.mockRejectedValue(new Error('offline'))

    await renderDashboard()

    // Not 75. The server never returns a null score, so a new driver whose call failed
    // would otherwise read the fleet prior as a score they had earned.
    // More than one '--' on the screen (the streak tiles show one too), so the
    // assertion that matters is that the prior is nowhere.
    expect(screen.queryAllByText('--').length).toBeGreaterThan(0)
    expect(screen.queryByText(String(FLEET_PRIOR))).toBeNull()
  })

  it('keeps the score a returning driver already earned when a refresh fails', async () => {
    mocked.stats.mockResolvedValueOnce({ stats: { totalTrips: 12, currentStreak: 3, bestStreak: 5 } as DrivingStats })

    const { rerender } = render(<DashboardScreen />)
    await act(async () => { await Promise.resolve() })
    expect(screen.getByText(String(FLEET_PRIOR))).toBeTruthy()

    // A later refresh that fails must leave the answer that did land alone.
    mocked.stats.mockRejectedValue(new Error('offline'))
    rerender(<DashboardScreen />)
    await act(async () => { await Promise.resolve() })

    expect(screen.getByText(String(FLEET_PRIOR))).toBeTruthy()
  })

  it('shows the placeholder to a driver the server reports no measured trips for', async () => {
    mocked.stats.mockResolvedValue({ stats: { totalTrips: 0, currentStreak: 0, bestStreak: 0 } as DrivingStats })

    await renderDashboard()

    expect(screen.queryByText(String(FLEET_PRIOR))).toBeNull()
    expect(screen.queryAllByText('--').length).toBeGreaterThan(0)
  })
})
