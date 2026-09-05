import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react-native'
import { RedeemConfirmSheet } from '@/components/marketplace/RedeemConfirmSheet'
import he from '@/i18n/he'
import type { Reward } from '@/types'

// The real context reaches the driving SDK; the sheet only needs a language.
jest.mock('@/context/AppContext', () => ({ useApp: () => ({ lang: 'HE' }) }))

const reward = {
  id: 'r1',
  business: 'Test Business',
  titleHe: 'פרס',
  titleEn: 'Reward',
  category: 'food',
  costPoints: 250,
  available: 5,
} as Reward

const props = {
  reward,
  // What is left after the cost is taken off, computed by the screen above. The sheet
  // is the last thing shown before points are spent, so this is half of what it exists
  // to say — the cost is the other half.
  availableAfter: 750,
  onConfirm: jest.fn(),
  onCancel: jest.fn(),
  loading: false,
  lang: 'HE' as const,
}

describe('RedeemConfirmSheet', () => {
  beforeEach(() => {
    props.onConfirm.mockClear()
    props.onCancel.mockClear()
  })

  // What it costs and what is left afterwards are the whole decision the sheet exists
  // to present, so both are asserted on the number rather than on the sheet rendering.
  it('states what the reward costs and what is left before anything is spent', () => {
    render(<RedeemConfirmSheet {...props} />)
    expect(screen.getByText(reward.titleHe)).toBeOnTheScreen()
    expect(screen.getByText(`250 ${he.common.points}`)).toBeOnTheScreen()
    expect(
      screen.getByText(`${he.marketplace.balanceAfter} 750 ${he.common.points}`)
    ).toBeOnTheScreen()
  })

  it('redeems on confirm', () => {
    render(<RedeemConfirmSheet {...props} />)
    fireEvent.press(screen.getByText(he.marketplace.redeem))
    expect(props.onConfirm).toHaveBeenCalled()
  })

  // A redemption in flight must not be sendable twice — the points are already
  // reserved server-side by the first call.
  it('refuses a second press while a redemption is in flight', () => {
    render(<RedeemConfirmSheet {...props} loading />)
    expect(screen.queryByText(he.marketplace.redeem)).toBeNull()
    fireEvent.press(screen.getByText('...'))
    expect(props.onConfirm).not.toHaveBeenCalled()
  })
})
