/**
 * The hero's score display, which is the whole point of CAR-294.
 *
 * The server never returns a null score — a driver with no measured trips gets the
 * fleet prior — so the old "no data" branch was unreachable and a brand-new driver
 * was shown a plausible number they never earned, coloured as if it were real. What
 * these tests pin is that `hasMeasuredHistory`, not the value, decides whether a
 * number is shown at all.
 */
import React from 'react'
import { render, screen } from '@testing-library/react-native'
import { DashboardHero } from '@/components/gamification/DashboardHero'
import { COLORS } from '@/constants/theme'
import { scoreToColor } from '@/lib/utils'

jest.mock('@/context/AppContext', () => ({ useApp: () => ({ lang: 'HE' }) }))

const user = { level: 3, totalPoints: 1200 }

const renderHero = (driverScore: number, hasMeasuredHistory: boolean) =>
  render(
    <DashboardHero user={user} driverScore={driverScore} hasMeasuredHistory={hasMeasuredHistory} lang="HE" />,
  )

const scoreStyle = (text: string) => {
  const flat = [screen.getByText(text).props.style].flat(Infinity)
  return Object.assign({}, ...flat.filter(Boolean))
}

describe('DashboardHero score', () => {
  it('shows a measured score in its own colour', () => {
    renderHero(82, true)
    expect(screen.getByText('82')).toBeTruthy()
    expect(scoreStyle('82').color).toBe(scoreToColor(82))
  })

  it('withholds the number when there is no measured history', () => {
    // The fleet prior is a real, plausible-looking number. Showing it is the bug.
    renderHero(72, false)
    expect(screen.queryByText('72')).toBeNull()
    expect(screen.getByText('--')).toBeTruthy()
  })

  it('does not colour the placeholder as if it were a score', () => {
    renderHero(72, false)
    expect(scoreStyle('--').color).toBe(COLORS.textMuted)
    expect(scoreStyle('--').color).not.toBe(scoreToColor(72))
  })

  it('withholds a score that is not a number at all', () => {
    // A profile deployed without the field rounds to NaN, which no null check catches.
    renderHero(NaN, false)
    expect(screen.getByText('--')).toBeTruthy()
    expect(screen.queryByText('NaN')).toBeNull()
  })

  it('shows a measured zero rather than treating it as missing', () => {
    renderHero(0, true)
    expect(screen.getByText('0')).toBeTruthy()
  })
})
