import type { ScoringInput, ScoringResult } from '@/navigation/types'

export function getRiskMultiplier(startTime: Date): number {
  const hour = startTime.getHours()
  const day  = startTime.getDay()
  const isNight = hour >= 23 || hour < 4
  if (!isNight) return 1.0
  const isWeekendNight = day === 4 || day === 5
  return isWeekendNight ? 2.0 : 1.5
}

export function calculateScore(input: ScoringInput): ScoringResult {
  const { hardBrakes, aggressiveAccels, sharpTurns, phoneSeconds, durationSeconds, distanceKm, startTime } = input
  const safeDuration = Math.max(durationSeconds, 1)
  const penalties =
    hardBrakes * 5 +
    aggressiveAccels * 3 +
    sharpTurns * 2 +
    (phoneSeconds / safeDuration) * 40

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
