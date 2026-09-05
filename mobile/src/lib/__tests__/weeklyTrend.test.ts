import { weeklyScoreTrend } from '@/lib/weeklyTrend'
import type { Trip } from '@/types'

// A Wednesday. The window it produces is Thu 27 Aug – Wed 2 Sep; the one before it is
// 20–26 Aug. Built in local time on purpose: the function buckets by the driver's
// calendar day, so a UTC literal would move the fixtures across a day boundary outside UTC.
const NOW = new Date(2026, 8, 2, 12, 0, 0)

const trip = (day: Date, avgScore: number, extra: Partial<Trip> = {}): Trip =>
  ({
    id: `t-${day.getMonth()}-${day.getDate()}-${day.getHours()}-${avgScore}`,
    startTime: day.toISOString(),
    avgScore,
    distanceKm: 10,
    ...extra,
  }) as Trip

const aug = (d: number, hour = 9) => new Date(2026, 7, d, hour, 0, 0)
const sep = (d: number, hour = 9) => new Date(2026, 8, d, hour, 0, 0)

describe('weeklyScoreTrend', () => {
  it('runs the seven days up to today, oldest first', () => {
    const { days, dayScores } = weeklyScoreTrend([], NOW)

    expect(days.map(d => d.getDate())).toEqual([27, 28, 29, 30, 31, 1, 2])
    expect(dayScores).toEqual([null, null, null, null, null, null, null])
  })

  it('averages each seven-day window and reports the direction between them', () => {
    const trend = weeklyScoreTrend(
      [trip(aug(31), 90), trip(sep(1), 80), trip(aug(25), 70), trip(aug(26), 60)],
      NOW,
    )

    expect(trend).toMatchObject({ thisWeek: 85, lastWeek: 65, delta: 20 })
    expect(trend.dayScores).toEqual([null, null, null, null, 90, 80, null])
  })

  it('averages the trips within a day before averaging the days', () => {
    const trend = weeklyScoreTrend(
      [trip(sep(1), 80), trip(sep(1, 17), 60), trip(aug(31), 100)],
      NOW,
    )

    expect(trend.dayScores[5]).toBe(70)
    expect(trend.thisWeek).toBe(85)
  })

  it('has no direction to report without a window to compare against', () => {
    expect(weeklyScoreTrend([trip(sep(1), 90)], NOW)).toMatchObject({
      thisWeek: 90, lastWeek: null, delta: null,
    })
  })

  it('has no direction to report when nothing was driven in the last seven days', () => {
    expect(weeklyScoreTrend([trip(aug(25), 70)], NOW)).toMatchObject({
      thisWeek: null, lastWeek: 70, delta: null,
    })
  })

  // The queued row carries a placeholder zero, which would drag the day down for a
  // trip nobody has scored yet.
  it('leaves an unsent trip out of the average', () => {
    const trend = weeklyScoreTrend(
      [trip(sep(1), 90), trip(aug(31), 0, { pendingSync: true })],
      NOW,
    )

    expect(trend).toMatchObject({ thisWeek: 90 })
    expect(trend.dayScores[4]).toBeNull()
  })

  it('ignores a trip dated later today rather than scoring driving that has not happened', () => {
    const trend = weeklyScoreTrend([trip(sep(2, 23), 10), trip(sep(1), 90)], NOW)

    expect(trend).toMatchObject({ thisWeek: 90 })
    expect(trend.dayScores[6]).toBeNull()
  })

  it('reports nothing at all for a driver with no trips', () => {
    expect(weeklyScoreTrend([], NOW)).toMatchObject({
      thisWeek: null, lastWeek: null, delta: null,
    })
  })
})
