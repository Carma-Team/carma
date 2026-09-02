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
})
