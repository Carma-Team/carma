/**
 * @fileoverview Trip score and points calculation — CARMA scoring engine
 * @module lib/scoring
 *
 * @description
 * Pure functions (no side effects) for:
 * - `getRiskMultiplier` — risk multiplier by hour/day (weekend nights = x2)
 * - `scoreToGrade` — maps score to excellent/good/fair/poor
 * - `scoreToColor` — maps score to a hex color (green → red)
 *
 * @remarks The server is the sole scoring oracle (`server/app/services/scoring_v2.py`).
 * The client never computes a score — it renders `avgScore`/`points` as returned by
 * `POST /api/trips`. `getRiskMultiplier` is the one exception: it is sent up with the
 * trip payload, so it must stay in parity with `scoring.get_risk_multiplier` on the server.
 */

export function getRiskMultiplier(startTime: Date): number {
  const hour = startTime.getHours()
  const day  = startTime.getDay()
  const isNight = hour >= 23 || hour < 4
  if (!isNight) return 1.0
  // Thu=4, Fri=5 (Israeli weekend start); Sat=6 (late night still high-risk)
  const isWeekendNight = day === 4 || day === 5 || day === 6
  return isWeekendNight ? 2.0 : 1.5
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
