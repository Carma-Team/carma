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
  rewardsApi: { list: jest.fn(), redeem: jest.fn(), cancel: jest.fn(), myVouchers: jest.fn() },
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
    // The contract makes this required, and the store card orders by it.
    createdAt: '2026-01-01T00:00:00Z',
    pointsCost: reward.costPoints,
    reward,
  }) as Voucher

const mocked = rewardsApi as jest.Mocked<typeof rewardsApi>

// The first test in this file mounts the whole screen and pulls in the QR component,
// the icon set and the modal on a cold module cache. That lands under a second on its
// own and has repeatedly crossed jest's 5s default when the suite runs in parallel, so
// the gate failed on machine load rather than on anything the test asserts.
jest.setTimeout(20000)

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

    // The store card no longer prints the code, so the row is reached by its label.
    fireEvent.press(screen.getByText(he.marketplace.voucher.owned))
    fireEvent.press(await screen.findByText(he.marketplace.voucher.cancel))
    const confirm = await screen.findByText(he.common.confirm)
    fireEvent.press(confirm)
    fireEvent.press(confirm)

    expect(mocked.cancel).toHaveBeenCalledTimes(1)
  })
})

describe('MarketplaceScreen batching', () => {
  // Distinct titles are what the assertions count — the card renders `titleHe` under
  // HE, so a numbered title gives every card a label of its own to match on.
  const catalog = (n: number): Reward[] =>
    Array.from({ length: n }, (_, i) => ({ ...reward, id: `r${i}`, titleHe: `פרס ${i}` }))

  async function renderCatalog(n: number) {
    mocked.list.mockResolvedValue({ rewards: catalog(n), vouchers: [] })
    render(<MarketplaceScreen />)
    await act(async () => {})
  }

  const cardCount = () => screen.queryAllByText(/^פרס \d+$/).length
  const moreButton = () => screen.queryByText(he.dashboard.showMore)

  it('shows at most the first batch on entry', async () => {
    await renderCatalog(15)
    expect(cardCount()).toBe(6)
  })

  it('appends a batch on each press and stops at the end of the catalog', async () => {
    await renderCatalog(15)

    fireEvent.press(moreButton()!)
    expect(cardCount()).toBe(12)

    // The last press lands on a partial batch — the button goes once the catalog is
    // exhausted, not once a press has been made.
    fireEvent.press(moreButton()!)
    expect(cardCount()).toBe(15)
    expect(moreButton()).toBeNull()
  })

  it('offers nothing to expand for a catalog that already fits', async () => {
    await renderCatalog(6)
    expect(moreButton()).toBeNull()
  })
})

describe('MarketplaceScreen owned vouchers', () => {
  const owned = (code: string, status: Voucher['status'], createdAt: string): Voucher =>
    ({ ...voucher(code), id: `v-${code}`, status, isUsed: status === 'used', createdAt }) as Voucher

  async function openVouchers(vouchers: Voucher[]) {
    mocked.list.mockResolvedValue({ rewards: [reward], vouchers: [] })
    mocked.myVouchers.mockResolvedValue({ vouchers })
    render(<MarketplaceScreen />)
    await act(async () => {})
    await act(async () => {
      fireEvent.press(screen.getByText(he.marketplace.tabMyVouchers))
    })
  }

  it('lists vouchers the catalog never returns, spent ones included', async () => {
    await openVouchers([owned('SPENT1', 'used', '2026-01-01T00:00:00Z')])

    expect(mocked.myVouchers).toHaveBeenCalled()
    expect(screen.getByText(/SPENT1/)).toBeTruthy()
    expect(screen.getByText(he.marketplace.voucher.used)).toBeTruthy()
  })

  it('names expired and cancelled by their own state instead of calling them active', async () => {
    await openVouchers([
      owned('GONE1', 'expired', '2026-01-01T00:00:00Z'),
      owned('DROP1', 'cancelled', '2026-01-02T00:00:00Z'),
    ])

    expect(screen.getByText(he.marketplace.voucher.expired)).toBeTruthy()
    expect(screen.getByText(he.marketplace.voucher.cancelled)).toBeTruthy()
    expect(screen.queryByText(he.marketplace.voucher.active)).toBeNull()
  })

  it('says so when the driver owns nothing yet', async () => {
    await openVouchers([])
    expect(screen.getByText(he.marketplace.noVouchers)).toBeTruthy()
  })

  it('opens the voucher it was tapped on', async () => {
    await openVouchers([owned('LIVE01', 'pending', '2026-01-01T00:00:00Z')])

    fireEvent.press(screen.getByText(/LIVE01/))

    expect(screen.getByTestId('voucher-modal-code')).toHaveTextContent('LIVE01')
  })
})
