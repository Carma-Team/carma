/**
 * The city field, which is the whole of CAR-224.
 *
 * The picker used to fall back to a free-text box whenever the list came back empty.
 * That existed because the old source (`/api/leaderboard/locations`) needed a bearer
 * token registration does not have, so it 401'd on every fresh install. The list is
 * public now, and the fallback is what let two spellings of one settlement back into
 * the data that CAR-218 exists to make canonical.
 */
import React from 'react'
import { render, screen, act } from '@testing-library/react-native'
import RegisterScreen from '@/screens/auth/RegisterScreen'
import { leaderboardApi } from '@/services/api/leaderboard.api'
import he from '@/i18n/he'

// Reached transitively through the API client, and absent under jest.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0 }) }))
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }))
jest.mock('@/services/api/leaderboard.api', () => ({ leaderboardApi: { getCities: jest.fn() } }))
jest.mock('@/services/api/auth.api', () => ({ authApi: { register: jest.fn() } }))
jest.mock('@/context/AppContext', () => ({
  useApp: () => ({ loginUser: jest.fn(), addToast: jest.fn(), lang: 'HE', setLang: jest.fn() }),
}))

const mocked = leaderboardApi as jest.Mocked<typeof leaderboardApi>

const TEL_AVIV = { code: 'TLV', nameHe: 'תל אביב', nameEn: 'Tel Aviv' }

async function renderRegister() {
  render(<RegisterScreen />)
  await act(async () => { await Promise.resolve() })
}

beforeEach(() => jest.clearAllMocks())

describe('RegisterScreen city field', () => {
  it('offers the canonical list through the picker', async () => {
    mocked.getCities.mockResolvedValue({
      country: { nameHe: 'ישראל', nameEn: 'Israel' },
      cities: [TEL_AVIV],
    })

    await renderRegister()

    expect(screen.getByText(he.auth.citySelectPlaceholder)).toBeTruthy()
  })

  it('keeps the picker when the list cannot be fetched, rather than a free-text box', async () => {
    mocked.getCities.mockRejectedValue(new Error('offline'))

    await renderRegister()

    // An empty picker, not a text input: city is optional, and typing one is what
    // put 'תל אביב' and 'Tel Aviv' in the same column.
    expect(screen.getByText(he.auth.citySelectPlaceholder)).toBeTruthy()
  })
})
