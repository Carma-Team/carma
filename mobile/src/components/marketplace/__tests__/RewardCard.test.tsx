import React from 'react'
import { render, screen } from '@testing-library/react-native'
import { RewardCard } from '@/components/marketplace/RewardCard'
import he from '@/i18n/he'
import type { Reward } from '@/types'

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

// Well above the cost, so the button only ever reflects availability.
const RICH = 5000

describe('RewardCard availability', () => {
  it('offers an uncapped reward — null is unlimited, not sold out', () => {
    render(<RewardCard reward={reward(null)} userPoints={RICH} onRedeem={jest.fn()} />)
    expect(screen.getByText(he.marketplace.redeem)).toBeEnabled()
  })

  it('offers a reward that still has units', () => {
    render(<RewardCard reward={reward(3)} userPoints={RICH} onRedeem={jest.fn()} />)
    expect(screen.getByText(he.marketplace.redeem)).toBeEnabled()
  })

  it('closes the action once a reward is sold out', () => {
    render(<RewardCard reward={reward(0)} userPoints={RICH} onRedeem={jest.fn()} />)
    expect(screen.queryByText(he.marketplace.redeem)).toBeNull()
    expect(screen.getByText(he.marketplace.outOfStock)).toBeDisabled()
  })
})
