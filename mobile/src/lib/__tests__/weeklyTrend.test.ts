import { weeklyScoreTrend } from '@/lib/weeklyTrend'
import type { Trip } from '@/types'

const NOW = new Date('2026-09-02T12:00:00Z').getTime()
const DAY = 24 * 60 * 60 * 1000

const trip = (daysAgo: number, avgScore: number, extra: Partial<Trip> = {}): Trip =>
  ({
    id: `t-${daysAgo}-${avgScore}`,
    startTime: new Date(NOW - daysAgo * DAY).toISOString(),
    avgScore,
    distanceKm: 10,
    ...extra,
  }) as Trip

describe('weeklyScoreTrend', () => {
  it('averages each week and reports the direction between them', () => {
    const trend = weeklyScoreTrend([trip(1, 90), trip(3, 80), trip(9, 70), trip(11, 60)], NOW)

    expect(trend).toMatchObject({ thisWeek: 85, lastWeek: 65, delta: 20, tripsThisWeek: 2 })
  })

  it('has no direction to report without a week to compare against', () => {
    const trend = weeklyScoreTrend([trip(1, 90)], NOW)

    expect(trend).toMatchObject({ thisWeek: 90, lastWeek: null, delta: null })
  })

  it('has no direction to report when nothing was driven this week', () => {
    const trend = weeklyScoreTrend([trip(9, 70)], NOW)

    expect(trend).toMatchObject({ thisWeek: null, lastWeek: 70, delta: null, tripsThisWeek: 0 })
  })

  // The queued row carries a placeholder zero, which would drag the week down for a
  // trip nobody has scored yet.
  it('leaves an unsent trip out of the average', () => {
    const trend = weeklyScoreTrend([trip(1, 90), trip(2, 0, { pendingSync: true })], NOW)

    expect(trend).toMatchObject({ thisWeek: 90, tripsThisWeek: 1 })
  })

  it('ignores a trip dated in the future rather than counting it as this week', () => {
    const trend = weeklyScoreTrend([trip(-2, 10), trip(1, 90)], NOW)

    expect(trend).toMatchObject({ thisWeek: 90, tripsThisWeek: 1 })
  })

  it('reports nothing at all for a driver with no trips', () => {
    expect(weeklyScoreTrend([], NOW)).toMatchObject({ thisWeek: null, lastWeek: null, delta: null })
  })

  // Every case above uses whole numbers, which is how the rounding defect survived:
  // the engine emits one decimal, and rounding each week before subtracting turned a
  // real improvement into a flat week (CAR-313).
  describe('fractional scores', () => {
    it('reports a change smaller than a point instead of flattening it to zero', () => {
      const trend = weeklyScoreTrend([trip(1, 83.4), trip(9, 82.6)], NOW)

      // Rounded first, both weeks are 83 and the driver is told nothing moved.
      expect(trend.delta).toBeCloseTo(0.8, 5)
      expect(trend).toMatchObject({ thisWeek: 83, lastWeek: 83 })
    })

    it('keeps the direction when the rounded weeks are equal but the real ones are not', () => {
      const trend = weeklyScoreTrend([trip(1, 82.6), trip(9, 83.4)], NOW)

      expect(trend.delta).toBeLessThan(0)
    })

    it('rounds the displayed weeks rather than handing on a raw average', () => {
      const trend = weeklyScoreTrend([trip(1, 83), trip(2, 84), trip(3, 84)], NOW)

      // 83.666… — the card renders this value directly, so it must not carry a tail.
      expect(trend.thisWeek).toBe(84)
    })

    it('rounds the delta to the one decimal a trip score carries', () => {
      const trend = weeklyScoreTrend([trip(1, 83), trip(2, 84), trip(9, 80)], NOW)

      // 83.5 - 80, exact rather than 3.4999999999999996.
      expect(trend.delta).toBe(3.5)
    })
  })
})
