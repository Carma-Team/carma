import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react-native'
import LeaderboardScreen from '@/screens/app/LeaderboardScreen'
import { leaderboardApi } from '@/services/api/leaderboard.api'
import he from '@/i18n/he'
import type { AppUser, LeaderboardEntry, LeaderboardOut } from '@/types'

// Replaced rather than provided: the real context boots the driving SDK and the API
// layer would reach the network. What is left under test is the screen's own paging.
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0 }) }))
jest.mock('@/services/api/leaderboard.api', () => ({
  leaderboardApi: { get: jest.fn(), getLocations: jest.fn() },
}))
jest.mock('@/services/api/user.api', () => ({ userApi: { searchByPhone: jest.fn() } }))
jest.mock('@/services/api/friends.api', () => ({
  friendsApi: { sendRequest: jest.fn(), removeFriend: jest.fn() },
}))

const CITY = { code: 'IL-TA', nameHe: 'תל אביב', nameEn: 'Tel Aviv' }

// Only the two members the screen reads. Cast through `unknown` rather than filled in:
// the rest of AppUser has no bearing on paging, and listing it would rot on the next
// schema change.
const mockUser = { id: 'u1', city: CITY } as unknown as AppUser

jest.mock('@/context/AppContext', () => ({
  useApp: () => ({ user: mockUser, addToast: jest.fn(), lang: 'HE', setLang: jest.fn() }),
}))

const mocked = leaderboardApi as jest.Mocked<typeof leaderboardApi>

// Names are what the assertions count, so each row gets one of its own to match on.
const board = (n: number, myRank: number | null = null): LeaderboardOut =>
  ({
    entries: Array.from({ length: n }, (_, i) => ({
      id: `e${i}`,
      userId: `u-${i}`,
      rank: i + 1,
      score: 100 - i,
      distanceKm: 10,
      followStatus: 'none',
      user: { id: `u-${i}`, name: `נהג ${i}`, level: 3, city: CITY, avatarUrl: null, isPrivate: false },
    })) as LeaderboardEntry[],
    currentUserId: 'u1',
    myRank,
  }) as LeaderboardOut

async function renderBoard(n: number, myRank: number | null = null) {
  mocked.getLocations.mockResolvedValue({ country: { nameHe: 'ישראל', nameEn: 'Israel' }, cities: [CITY] })
  mocked.get.mockResolvedValue(board(n, myRank))
  render(<LeaderboardScreen />)
  await act(async () => {})
}

// The list's own `data`, not the rendered rows: FlatList virtualises, so counting
// what is on screen measures the window size rather than the paging decision.
const rowCount = () => screen.getByTestId('leaderboard-list').props.data.length
const moreButton = () => screen.queryByText(he.dashboard.showMore)

beforeEach(() => jest.clearAllMocks())

describe('LeaderboardScreen batching', () => {
  it('shows at most the first batch on entry', async () => {
    await renderBoard(25)
    expect(rowCount()).toBe(10)
  })

  it('appends a batch on each press and stops at the end of the board', async () => {
    await renderBoard(25)

    fireEvent.press(moreButton()!)
    expect(rowCount()).toBe(20)

    // The last press lands on a partial batch — the button goes once the board is
    // exhausted, not once a press has been made.
    fireEvent.press(moreButton()!)
    expect(rowCount()).toBe(25)
    expect(moreButton()).toBeNull()
  })

  it('offers nothing to expand for a board that already fits', async () => {
    await renderBoard(10)
    expect(moreButton()).toBeNull()
  })

  it('still tells an unranked viewer their rank before they have paged', async () => {
    // The banner asks whether the viewer is on the board at all, which is a question
    // about the whole response and not about how far they have scrolled through it.
    await renderBoard(25, 142)
    expect(screen.getByText(`${he.leaderboard.yourRank}: #142`)).toBeTruthy()
  })
})
