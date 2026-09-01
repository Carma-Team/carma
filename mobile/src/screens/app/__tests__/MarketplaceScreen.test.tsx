import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react-native'
import MarketplaceScreen from '@/screens/app/MarketplaceScreen'
import { ApiError } from '@/services/api/client'
import { rewardsApi } from '@/services/api/rewards.api'
import he from '@/i18n/he'
import { formatDuration } from '@/lib/utils'
import type { AppUser, Reward, Voucher } from '@/types'

// The screen's own dependencies are replaced, not provided: the real context boots the
// driving SDK, the API layer would reach the network, and the QR component needs a
// native canvas. What is left under test is the screen's own decisions.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
)
jest.mock('react-native-qrcode-svg', () => 'QRCode')
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0 }) }))
jest.mock('@/services/api/rewards.api', () => ({
  rewardsApi: { list: jest.fn(), redeem: jest.fn(), cancel: jest.fn() },
}))

// The `mock` prefix is load-bearing: `jest.mock` is hoisted above these declarations,
// and its factory may only reach variables named this way.
const mockAddToast = jest.fn()
const mockUser = {
  id: 'u1',
  points: 5000,
  totalPoints: 5000,
  availablePoints: 5000,
  reservedPoints: 0,
} as AppUser

jest.mock('@/context/AppContext', () => ({
  useApp: () => ({
    user: mockUser,
    patchUser: jest.fn(),
    addToast: mockAddToast,
    lang: 'HE',
    setLang: jest.fn(),
  }),
}))

const reward: Reward = {
  id: 'r1',
  business: 'Test Business',
  titleHe: 'פרס',
  titleEn: 'Reward',
  category: 'food',
  costPoints: 100,
  available: null,
} as Reward

const voucher = (code: string): Voucher =>
  ({
    id: `v-${code}`,
    rewardId: reward.id,
    code,
    qrData: `qr:${code}`,
    status: 'pending',
    isUsed: false,
    expiresAt: '2030-01-01T00:00:00Z',
    pointsCost: reward.costPoints,
    reward,
  }) as Voucher

const mocked = rewardsApi as jest.Mocked<typeof rewardsApi>

/**
 * Renders and settles the catalog load, so the cards are on screen.
 *
 * The load is flushed rather than polled for: the screen's state lands under React's
 * control before the test looks, and there is no waiting window for a cold first run
 * in this file to outlast.
 */
async function renderStore(vouchers: Voucher[] = []) {
  mocked.list.mockResolvedValue({ rewards: [reward], vouchers })
  render(<MarketplaceScreen />)
  // Empty on purpose: `render` may not be called inside it — the render result is
  // built by reaching into the renderer, which act does not allow. What is needed
  // here is only the flush it performs on the way out.
  await act(async () => {})
}

/**
 * Opens the confirmation sheet from the card, then confirms.
 *
 * Opening is a plain state update, which `fireEvent` has already committed — so both
 * buttons are on screen by the time this reads them. They carry the same label and the
 * sheet's is the second, which the count asserts rather than assumes.
 *
 * Confirming runs an async handler, and its state updates land after the promise it
 * awaits. `act` holds the test until they are committed; without it they arrive behind
 * React's back and the voucher is sometimes not open yet when the assertion looks.
 */
async function redeemOnce() {
  fireEvent.press(screen.getByText(he.marketplace.redeem))
  const buttons = screen.getAllByText(he.marketplace.redeem)
  expect(buttons).toHaveLength(2)
  await act(async () => {
    fireEvent.press(buttons[buttons.length - 1])
  })
}

beforeEach(() => jest.clearAllMocks())

describe('MarketplaceScreen redemption', () => {
  it('opens the voucher it just issued', async () => {
    mocked.redeem.mockResolvedValue({ voucher: voucher('FIRST1') })
    await renderStore()

    await redeemOnce()

    expect(screen.getByText(he.marketplace.voucher.title)).toBeTruthy()
    expect(screen.getByTestId('voucher-modal-code')).toHaveTextContent('FIRST1')
  })

  it('opens the second voucher too, on a reward that already holds one', async () => {
    mocked.redeem.mockResolvedValue({ voucher: voucher('SECOND2') })
    await renderStore([voucher('FIRST1')])

    await redeemOnce()

    expect(screen.getByText(he.marketplace.voucher.title)).toBeTruthy()
    // The one that just opened is the new voucher, not the one already held.
    expect(screen.getByTestId('voucher-modal-code')).toHaveTextContent('SECOND2')
  })

  it('reports the cooldown with the wait the server sent', async () => {
    mocked.redeem.mockRejectedValue(
      new ApiError(409, 'cooldown', 45, 'VOUCHER_REISSUE_COOLDOWN')
    )
    await renderStore()

    await redeemOnce()

    expect(mockAddToast).toHaveBeenCalled()
    const { type, message } = mockAddToast.mock.calls[0][0]
    expect(type).toBe('error')
    // The duration is the server's, rendered into the sentence — never a number this
    // screen derived, and never a leftover placeholder.
    expect(message).toBe(
      he.marketplace.redeemCooldownWait.replace('{wait}', formatDuration(45, 'HE'))
    )
  })

  it('falls back to the plain reason when the server sends no wait', async () => {
    mocked.redeem.mockRejectedValue(
      new ApiError(409, 'cooldown', undefined, 'VOUCHER_REISSUE_COOLDOWN')
    )
    await renderStore()

    await redeemOnce()

    expect(mockAddToast).toHaveBeenCalled()
    expect(mockAddToast.mock.calls[0][0].message).toBe(he.marketplace.redeemCooldown)
  })
})

describe('MarketplaceScreen cancellation', () => {
  it('sends the cancellation once however many times the button is pressed', async () => {
    // Never resolves: the request is still in flight when the second press lands.
    mocked.cancel.mockReturnValue(new Promise(() => {}))
    await renderStore([voucher('HELD01')])

    fireEvent.press(screen.getByText('HELD01'))
    fireEvent.press(await screen.findByText(he.marketplace.voucher.cancel))
    const confirm = await screen.findByText(he.common.confirm)
    fireEvent.press(confirm)
    fireEvent.press(confirm)

    expect(mocked.cancel).toHaveBeenCalledTimes(1)
  })
})
