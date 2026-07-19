/**
 * @fileoverview Trip score and points calculation — CARMA scoring engine
 * @module lib/scoring
 *
 * @description
 * Pure functions (no side effects) for:
 * - `calculateScore` — 0–100 score based on driving events, distance, and time; also returns earned points.
 * - `getRiskMultiplier` — risk multiplier by hour/day (weekend nights = x2)
 * - `scoreToGrade` — maps score to excellent/good/fair/poor
 * - `scoreToColor` — maps score to a hex color (green → red)
 *
 * @remarks No server calls — local calculation only. Final score is sent to the server via tripsApi.save().
 */
import type { ScoringInput, ScoringResult } from '@/types'

export function getRiskMultiplier(startTime: Date): number {
  const hour = startTime.getHours()
  const day  = startTime.getDay()
  const isNight = hour >= 23 || hour < 4
  if (!isNight) return 1.0
  // Thu=4, Fri=5 (Israeli weekend start); Sat=6 (late night still high-risk)
  const isWeekendNight = day === 4 || day === 5 || day === 6
  return isWeekendNight ? 2.0 : 1.5
}

export function calculateScore(input: ScoringInput): ScoringResult {
  const { hardBrakes, aggressiveAccels, sharpTurns, touchEpochs, screenInteractionSeconds, durationSeconds, distanceKm, startTime } = input
  // const { swerves } = input  // EVT_SWERVE disabled — uncomment when re-enabling
  const safeDuration = Math.max(durationSeconds, 1)
  // Penalty weights MUST match the server oracle (server/app/services/scoring.py),
  // which is authoritative — it recomputes and overrides the client's score:
  //   hardBrakes=5, aggressiveAccels=3, sharpTurns=2, touchEpochs=4
  const penalties =
    hardBrakes * 5 +
    aggressiveAccels * 3 +
    sharpTurns * 2 +
    // swerves * 5 +        // EVT_SWERVE disabled — spec severity = 5
    touchEpochs * 4 +
    (screenInteractionSeconds / safeDuration) * 40

  const score          = Math.max(0, Math.min(100, 100 - penalties))
  const distanceFactor = Math.log(distanceKm + 1) / Math.log(11)
  const riskMultiplier = getRiskMultiplier(startTime)
  const points         = score * distanceFactor * riskMultiplier

  return {
    score:          Math.round(score * 10) / 10,
    points:         Math.round(points * 10) / 10,
    riskMultiplier,
    penalties:      Math.round(penalties * 10) / 10,
    distanceFactor: Math.round(distanceFactor * 1000) / 1000,
  }
}

export function scoreToGrade(score: number): 'excellent' | 'good' | 'fair' | 'poor' {
  if (score >= 90) return 'excellent'
  if (score >= 75) return 'good'
  if (score >= 55) return 'fair'
  return 'poor'
}

export function scoreToColor(score: number): string {
  if (score >= 90) return '#22c55e'
  if (score >= 75) return '#84cc16'
  if (score >= 55) return '#f59e0b'
  return '#ef4444'
}
