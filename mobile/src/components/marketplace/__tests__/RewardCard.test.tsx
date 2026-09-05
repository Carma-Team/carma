import React from 'react'
import { render, screen } from '@testing-library/react-native'
import { RewardCard } from '@/components/marketplace/RewardCard'
import he from '@/i18n/he'
import type { Reward, Voucher } from '@/types'

// Both modules are replaced rather than provided: the real context pulls in the
// driving SDK, and the QR component belongs to the voucher modal in the same file,
// which these tests never render.
jest.mock('@/context/AppContext', () => ({ useApp: () => ({ lang: 'HE' }) }))
jest.mock('react-native-qrcode-svg', () => 'QRCode')

const reward = (available: number | null): Reward =>
  ({
    id: 'r1',
    business: 'Test Business',
    titleHe: 'פרס',
    titleEn: 'Reward',
    category: 'food',
    costPoints: 100,
    available,
  }) as Reward

const voucher = (code: string): Voucher =>
  ({
    id: `v-${code}`,
    rewardId: 'r1',
    code,
    status: 'pending',
    isUsed: false,
    expiresAt: '2030-01-01T00:00:00Z',
    // The contract makes this required, and the card orders the strip by it. One value
    // for every fixture keeps the sort stable, so a row's number is its input position.
    createdAt: '2026-01-01T00:00:00Z',
    pointsCost: 100,
    reward: reward(null),
  }) as Voucher

// Well above the cost, so the button only ever reflects availability.
const RICH = 5000

function renderCard(props: Partial<React.ComponentProps<typeof RewardCard>> = {}) {
  return render(
    <RewardCard
      reward={reward(null)}
      userPoints={RICH}
      vouchers={[]}
      onRedeem={jest.fn()}
      onVoucherPress={jest.fn()}
      {...props}
    />
  )
}

describe('RewardCard availability', () => {
  it('offers an uncapped reward — null is unlimited, not sold out', () => {
    renderCard({ reward: reward(null) })
    expect(screen.getByText(he.marketplace.redeem)).toBeEnabled()
  })

  it('offers a reward that still has units', () => {
    renderCard({ reward: reward(3) })
    expect(screen.getByText(he.marketplace.redeem)).toBeEnabled()
  })

  it('closes the action once a reward is sold out', () => {
    renderCard({ reward: reward(0) })
    expect(screen.queryByText(he.marketplace.redeem)).toBeNull()
    expect(screen.getByText(he.marketplace.outOfStock)).toBeDisabled()
  })

  it('measures affordability against the available balance, not the total', () => {
    renderCard({ userPoints: 40 })
    expect(screen.queryByText(he.marketplace.redeem)).toBeNull()
    expect(screen.getByText(`${he.marketplace.missingPoints} 60 ${he.common.points}`)).toBeTruthy()
  })
})

describe('RewardCard live vouchers', () => {
  it('shows nothing extra when the driver holds none', () => {
    renderCard()
    expect(screen.queryByText(he.marketplace.voucherCap)).toBeNull()
    expect(screen.getByText(he.marketplace.redeem)).toBeEnabled()
  })

  // The code is the driver's proof at a till, and it stays in My Vouchers and in the QR
  // modal. On a card in the store it told a browsing driver nothing they could act on.
  it('says a voucher is already held rather than printing its code', () => {
    renderCard({ vouchers: [voucher('AAA111')] })
    expect(screen.getByText(he.marketplace.voucher.owned)).toBeTruthy()
    expect(screen.queryByText('AAA111')).toBeNull()
    expect(screen.getByText(he.marketplace.redeem)).toBeEnabled()
  })

  // Two rows carrying one label are indistinguishable, and the driver has to know which
  // of the two the QR belongs to.
  it('numbers the rows when the driver holds both vouchers', () => {
    renderCard({ vouchers: [voucher('AAA111'), voucher('BBB222')] })
    expect(screen.getByText(`${he.marketplace.voucher.owned} (1)`)).toBeTruthy()
    expect(screen.getByText(`${he.marketplace.voucher.owned} (2)`)).toBeTruthy()
  })

  it('stops offering the reward at the two-voucher ceiling', () => {
    renderCard({ vouchers: [voucher('AAA111'), voucher('BBB222')] })
    expect(screen.getByText(he.marketplace.voucherCap)).toBeTruthy()
    expect(screen.getByText(he.marketplace.redeem)).toBeDisabled()
  })

  // The ceiling hint replaces the "you are short X points" one rather than joining
  // it: a driver at the cap cannot redeem at any balance, so pricing is not the story.
  it('prefers the ceiling hint over the missing-points hint', () => {
    renderCard({ userPoints: 40, vouchers: [voucher('AAA111'), voucher('BBB222')] })
    expect(screen.getByText(he.marketplace.voucherCap)).toBeTruthy()
    expect(screen.queryByText(`${he.marketplace.missingPoints} 60 ${he.common.points}`)).toBeNull()
  })
})
