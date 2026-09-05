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
  /** Score for each of those days, rounded for display, null where nothing was driven. */
  dayScores: (number | null)[]
  /** Mean of those day averages, rounded for display, or null when nothing was driven in them. */
  thisWeek: number | null
  /** Same for the seven days before those, or null when there is no history. */
  lastWeek: number | null
  /**
   * Signed change between the two unrounded means, or null when either side is missing
   * — there is no direction then. Carries one decimal, because a trip score does: it is
   * the caller's to format, and the sign is the part the card reads.
   */
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

/**
 * The unrounded average. Rounding here and subtracting afterwards turned a real change
 * into a flat week: trip scores carry one decimal, so 83.4 against 82.6 is a +0.8
 * improvement that both rounded to 83 and reported as no movement at all (CAR-313).
 */
function mean(scores: number[]): number | null {
  if (scores.length === 0) return null
  return scores.reduce((sum, s) => sum + s, 0) / scores.length
}

/** One decimal, which is what a trip score carries — not a float with a tail. */
function round1(value: number): number {
  return Math.round(value * 10) / 10
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
    // Rounded on the way out, so a raw 83.428571… never reaches a circle. The means
    // above are taken from the unrounded averages, which is the whole point of CAR-313.
    dayScores: dayScores.map((s) => (s === null ? null : Math.round(s))),
    thisWeek: thisWeek === null ? null : Math.round(thisWeek),
    lastWeek: lastWeek === null ? null : Math.round(lastWeek),
    delta: thisWeek === null || lastWeek === null ? null : round1(thisWeek - lastWeek),
  }
}
