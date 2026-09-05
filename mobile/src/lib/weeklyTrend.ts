/**
 * @file weeklyTrend.ts
 * @owner May (Mobile & Frontend UI Lead)
 * @brief The last seven days of driving scores and the change against the seven before
 * them, computed from the trips the client already holds. A rolling window rather than a
 * calendar week: a calendar week needs a first day, which differs by locale and would
 * make the whole strip jump on the day it rolls over.
 */
import type { Trip } from '@/types'

export interface WeekScores {
  /** The last seven days, oldest first, ending on the day `now` falls in. */
  days: Date[]
  /** Score for each of those days, null where nothing was driven. */
  dayScores: (number | null)[]
  /** Mean of those day averages, or null when nothing was driven in them. */
  thisWeek: number | null
  /** Same for the seven days before those, or null when there is no history. */
  lastWeek: number | null
  /** Signed change, or null when either side is missing — there is no direction then. */
  delta: number | null
}

/** Local calendar day, not UTC — a trip at 01:00 belongs to the day the driver had. */
function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

/** `count` consecutive days ending on `end`, oldest first. */
function daysEndingOn(end: Date, count: number): Date[] {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(end)
    d.setHours(0, 0, 0, 0)
    d.setDate(end.getDate() - (count - 1 - i))
    return d
  })
}

function mean(scores: number[]): number | null {
  if (scores.length === 0) return null
  return Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length)
}

export function weeklyScoreTrend(trips: Trip[], now: Date = new Date()): WeekScores {
  const byDay = new Map<string, number[]>()
  for (const trip of trips) {
    // A trip still on its way to the server carries a placeholder zero, not a score
    // nobody gave — averaging it in would drag the day down for a trip that has not
    // been rated yet. A trip the queue has given up on keeps this same flag, so it is
    // covered here too.
    if (trip.pendingSync) continue
    const date = new Date(trip.startTime)
    if (isNaN(date.getTime())) continue
    // A start time later today is bad data, not driving that has happened. Only today
    // needs the guard — every other bucket is a day already over.
    if (date.getTime() > now.getTime()) continue
    const key = dayKey(date)
    if (!byDay.has(key)) byDay.set(key, [])
    byDay.get(key)!.push(trip.avgScore ?? 0)
  }

  const dayAverage = (date: Date) => mean(byDay.get(dayKey(date)) ?? [])

  const days = daysEndingOn(now, 7)
  const previous = new Date(now)
  previous.setDate(now.getDate() - 7)

  const dayScores = days.map(dayAverage)
  // Mean of the day averages, so the header agrees with the circles below it rather
  // than with a separate per-trip mean that would read as a different number.
  const thisWeek = mean(dayScores.filter((s): s is number => s !== null))
  const lastWeek = mean(
    daysEndingOn(previous, 7).map(dayAverage).filter((s): s is number => s !== null),
  )

  return {
    days,
    dayScores,
    thisWeek,
    lastWeek,
    delta: thisWeek === null || lastWeek === null ? null : thisWeek - lastWeek,
  }
}
