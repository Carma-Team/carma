/**
 * @file riskMultiplier.ts
 * @owner Dan (CPO) — scoring algorithm
 * @brief Time-of-drive risk multiplier, sent up with every trip payload.
 * The only piece of the scoring algorithm the client computes: it must stay in
 * numeric parity with `get_risk_multiplier` in `server/app/services/risk.py`.
 *
 * @remarks The server is the sole scoring oracle (`server/app/services/scoring.py`).
 * The client never computes a score — it renders `avgScore`/`points` as returned by
 * `POST /api/trips`. This function is the one exception, because it is part of the
 * payload rather than of the response.
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
