/**
 * @fileoverview Score display helpers
 * @module lib/scoring
 *
 * @description
 * Pure functions (no side effects) for:
 * - `scoreToGrade` — maps score to excellent/good/fair/poor
 * - `scoreToColor` — maps score to a hex color (green → red)
 *
 * @remarks The server is the sole scoring oracle (`server/app/services/scoring.py`).
 * The client computes no part of the score and no input to it — it renders
 * `avgScore`/`points`/`riskMultiplier` as returned by `POST /api/trips`.
 */

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
