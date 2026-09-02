/**
 * @file weeklyTrend.ts
 * @owner May (Mobile & Frontend UI Lead)
 * @brief Week-over-week driving trend, computed from the trips the client already holds.
 * Averages the scored trips in the last seven days against the seven before them and
 * reports the direction between them.
 */
import type { Trip } from '@/types'

/** Rolling seven days, not a calendar week: a calendar week needs a first day, which
 *  differs by locale and would make the trend jump on the day it rolls over. */
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export interface WeeklyTrend {
  /** Mean score of the last seven days, or null when nothing was scored in them. */
  thisWeek: number | null
  /** Mean score of the seven days before those, or null when there is no history. */
  lastWeek: number | null
  /** Signed change, or null when either side is missing — there is no direction then. */
  delta: number | null
  tripsThisWeek: number
}

function mean(scores: number[]): number | null {
  if (scores.length === 0) return null
  return Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length)
}

export function weeklyScoreTrend(trips: Trip[], now: number = Date.now()): WeeklyTrend {
  const thisWeekScores: number[] = []
  const lastWeekScores: number[] = []

  for (const trip of trips) {
    // A trip still on its way to the server carries a placeholder zero, not a score
    // nobody gave — averaging it in would drag the week down for a trip that has not
    // been rated yet. A trip the queue has given up on keeps this same flag, so it is
    // covered here too.
    if (trip.pendingSync) continue

    const age = now - new Date(trip.startTime).getTime()
    if (age < 0) continue
    if (age < WEEK_MS) thisWeekScores.push(trip.avgScore)
    else if (age < WEEK_MS * 2) lastWeekScores.push(trip.avgScore)
  }

  const thisWeek = mean(thisWeekScores)
  const lastWeek = mean(lastWeekScores)

  return {
    thisWeek,
    lastWeek,
    delta: thisWeek === null || lastWeek === null ? null : thisWeek - lastWeek,
    tripsThisWeek: thisWeekScores.length,
  }
}
