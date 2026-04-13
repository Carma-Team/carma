import type { ScoringInput, ScoringResult } from '@/types'

/**
 * Risk-hour schedule:
 *  - Thu/Fri 23:00–04:00 → 2.0x (Israeli weekend nights)
 *  - Any night 23:00–04:00 → 1.5x
 *  - Otherwise → 1.0x
 */
export function getRiskMultiplier(startTime: Date): number {
  const hour = startTime.getHours()
  const day = startTime.getDay() // 0=Sun … 6=Sat

  const isNight = hour >= 23 || hour < 4
  if (!isNight) return 1.0

  // In Israel, Thursday night (4) and Friday night (5) = "weekend" nights
  const isWeekendNight = day === 4 || day === 5
  return isWeekendNight ? 2.0 : 1.5
}

/**
 * Main scoring algorithm.
 *
 * penalties  = braking*5 + accel*3 + turns*2 + (phone_secs/duration_secs)*40
 * base_score = clamp(100 - penalties, 0, 100)
 * dist_factor = log(distance_km + 1) / log(11)   // 0–1 scale (max at ~10 km)
 * points      = base_score * dist_factor * risk_multiplier
 */
export function calculateScore(input: ScoringInput): ScoringResult {
  const {
    hardBrakes,
    aggressiveAccels,
    sharpTurns,
    phoneSeconds,
    durationSeconds,
    distanceKm,
    startTime,
  } = input

  const safeDuration = Math.max(durationSeconds, 1)
  const penalties =
    hardBrakes * 5 +
    aggressiveAccels * 3 +
    sharpTurns * 2 +
    (phoneSeconds / safeDuration) * 40

  const score = Math.max(0, Math.min(100, 100 - penalties))
  const distanceFactor = Math.log(distanceKm + 1) / Math.log(11)
  const riskMultiplier = getRiskMultiplier(startTime)
  const points = score * distanceFactor * riskMultiplier

  return {
    score: Math.round(score * 10) / 10,
    points: Math.round(points * 10) / 10,
    riskMultiplier,
    penalties: Math.round(penalties * 10) / 10,
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
