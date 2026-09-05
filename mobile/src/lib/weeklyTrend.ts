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
  /** Mean score of the last seven days, rounded for display, or null when nothing was scored in them. */
  thisWeek: number | null
  /** Mean score of the seven days before those, rounded for display, or null when there is no history. */
  lastWeek: number | null
  /**
   * Signed change between the two unrounded means, or null when either side is missing
   * — there is no direction then. Carries one decimal, because a trip score does: it is
   * the caller's to format, and the sign is the part the card reads.
   */
  delta: number | null
  tripsThisWeek: number
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
    // Rounded on the way out, so a raw 83.428571… never reaches a card. The subtraction
    // above it is the one place the fractions have to survive.
    thisWeek: thisWeek === null ? null : Math.round(thisWeek),
    lastWeek: lastWeek === null ? null : Math.round(lastWeek),
    delta: thisWeek === null || lastWeek === null ? null : round1(thisWeek - lastWeek),
    tripsThisWeek: thisWeekScores.length,
  }
}
