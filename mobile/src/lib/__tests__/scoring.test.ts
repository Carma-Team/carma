import {
  getRiskMultiplier,
  calculateScore,
  scoreToGrade,
  scoreToColor,
} from '@/lib/scoring'

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a Date with a specific day and hour, using fixed Jan-2026 dates
 *  (verified: Jan-5=Mon, Jan-6=Tue, Jan-8=Thu, Jan-9=Fri, Jan-10=Sat, Jan-11=Sun) */
function makeDate(day: 'tue' | 'mon' | 'thu' | 'fri' | 'sat' | 'sun', hour: number): Date {
  const dayMap = { mon: 5, tue: 6, wed: 7, thu: 8, fri: 9, sat: 10, sun: 11 } as const
  return new Date(2026, 0, dayMap[day], hour, 0, 0, 0)
}

const BASE_INPUT = {
  hardBrakes: 0,
  aggressiveAccels: 0,
  sharpTurns: 0,
  swerves: 0,
  touchEpochs: 0,
  screenInteractionSeconds: 0,
  durationSeconds: 120,
  distanceKm: 5,
  startTime: makeDate('tue', 12), // Tuesday noon — daytime, multiplier 1.0
}

// ─── getRiskMultiplier ────────────────────────────────────────────────────────

describe('getRiskMultiplier', () => {
  it('returns 1.0 during daytime (any day)', () => {
    expect(getRiskMultiplier(makeDate('tue', 12))).toBe(1.0)
    expect(getRiskMultiplier(makeDate('thu', 14))).toBe(1.0)
    expect(getRiskMultiplier(makeDate('sat', 10))).toBe(1.0)
  })

  it('returns 1.0 at boundary hour 04:00 (not night)', () => {
    expect(getRiskMultiplier(makeDate('mon', 4))).toBe(1.0)
  })

  it('returns 1.5 on weekday night (Mon 23:30)', () => {
    expect(getRiskMultiplier(makeDate('mon', 23))).toBe(1.5)
  })

  it('returns 1.5 on Sunday night (early AM)', () => {
    expect(getRiskMultiplier(makeDate('sun', 2))).toBe(1.5)
  })

  it('returns 1.5 at boundary hour 23:00 on a weekday', () => {
    expect(getRiskMultiplier(makeDate('mon', 23))).toBe(1.5)
  })

  it('returns 2.0 on Thursday night 23:30', () => {
    expect(getRiskMultiplier(makeDate('thu', 23))).toBe(2.0)
  })

  it('returns 2.0 on Friday night early AM (01:00)', () => {
    expect(getRiskMultiplier(makeDate('fri', 1))).toBe(2.0)
  })

  it('returns 2.0 on Saturday night 23:30 (Issue #6 fix)', () => {
    expect(getRiskMultiplier(makeDate('sat', 23))).toBe(2.0)
  })

  it('returns 1.5 at 03:59 boundary on a weekday', () => {
    const d = new Date(2026, 0, 5, 3, 59) // Monday 03:59
    expect(getRiskMultiplier(d)).toBe(1.5)
  })
})

// ─── calculateScore ───────────────────────────────────────────────────────────

describe('calculateScore', () => {
  describe('score formula', () => {
    it('returns score 100 and correct points for a clean 5km daytime trip', () => {
      const result = calculateScore(BASE_INPUT)
      expect(result.score).toBe(100)
      expect(result.penalties).toBe(0)
      expect(result.riskMultiplier).toBe(1.0)
      expect(result.distanceFactor).toBe(0.747)
      expect(result.points).toBe(74.7)
    })

    it('applies hard brake penalty (5 pts each)', () => {
      const result = calculateScore({ ...BASE_INPUT, hardBrakes: 2 })
      expect(result.penalties).toBe(10)
      expect(result.score).toBe(90)
      expect(result.points).toBe(67.2) // 90 × 0.747 × 1.0
    })

    it('applies aggressive accel penalty (3 pts each)', () => {
      const result = calculateScore({ ...BASE_INPUT, aggressiveAccels: 3 })
      expect(result.penalties).toBe(9)
      expect(result.score).toBe(91)
    })

    it('applies sharp turn penalty (2 pts each — parity with server oracle)', () => {
      const result = calculateScore({ ...BASE_INPUT, sharpTurns: 5 })
      expect(result.penalties).toBe(10)
      expect(result.score).toBe(90)
    })

    it('applies screen interaction penalty proportionally (SIS / duration × 40)', () => {
      // screenInteractionSeconds=30 on 60s trip = 50% hand-held → 20 penalty
      const result = calculateScore({
        ...BASE_INPUT,
        screenInteractionSeconds: 30,
        durationSeconds: 60,
      })
      expect(result.penalties).toBe(20)
      expect(result.score).toBe(80)
      expect(result.points).toBe(59.8) // 80 × 0.747 × 1.0
    })

    it('clamps score to 0 when penalties exceed 100', () => {
      const result = calculateScore({ ...BASE_INPUT, hardBrakes: 25 }) // 125 penalty
      expect(result.score).toBe(0)
      expect(result.points).toBe(0)
    })

    it('accumulates mixed penalties correctly', () => {
      // 1 HB(5) + 1 AA(3) + 1 ST(2) = 10 → score 90
      const result = calculateScore({
        ...BASE_INPUT,
        hardBrakes: 1,
        aggressiveAccels: 1,
        sharpTurns: 1,
      })
      expect(result.penalties).toBe(10)
      expect(result.score).toBe(90)
    })
  })

  describe('distance factor', () => {
    it('gives distanceFactor 0 for 0km trip (no points earned)', () => {
      const result = calculateScore({ ...BASE_INPUT, distanceKm: 0 })
      expect(result.distanceFactor).toBe(0)
      expect(result.points).toBe(0)
    })

    it('gives distanceFactor 1.0 for exactly 10km trip', () => {
      const result = calculateScore({ ...BASE_INPUT, distanceKm: 10 })
      expect(result.distanceFactor).toBe(1)
    })

    it('gives diminishing returns above 10km', () => {
      const result = calculateScore({ ...BASE_INPUT, distanceKm: 20 })
      // log(21)/log(11) ≈ 1.092 → still scales points above 10km trips
      expect(result.distanceFactor).toBeGreaterThan(1)
    })
  })

  describe('risk multiplier', () => {
    it('doubles points on Thursday-night compared to daytime (same trip)', () => {
      const day = makeDate('tue', 12)  // 1.0×
      const night = makeDate('thu', 23) // 2.0×
      const dayResult = calculateScore({ ...BASE_INPUT, startTime: day })
      const nightResult = calculateScore({ ...BASE_INPUT, startTime: night })
      expect(nightResult.riskMultiplier).toBe(2.0)
      expect(nightResult.points).toBeCloseTo(dayResult.points * 2, 1)
    })

    it('applies 1.5× on weekday night', () => {
      const result = calculateScore({ ...BASE_INPUT, startTime: makeDate('mon', 23) })
      expect(result.riskMultiplier).toBe(1.5)
      expect(result.points).toBe(112.1) // 100 × 0.747 × 1.5
    })

    it('applies 2.0× on Saturday night (Issue #6 regression guard)', () => {
      const result = calculateScore({ ...BASE_INPUT, startTime: makeDate('sat', 23) })
      expect(result.riskMultiplier).toBe(2.0)
      expect(result.points).toBe(149.4) // 100 × 0.747 × 2.0
    })
  })

  describe('edge cases', () => {
    it('uses safeDuration=1 when durationSeconds=0 (avoids division by zero)', () => {
      // With durationSeconds=0 and screenInteractionSeconds=60: penalty = (60/1)*40 = 2400 → score=0
      const result = calculateScore({
        ...BASE_INPUT,
        durationSeconds: 0,
        screenInteractionSeconds: 60,
      })
      expect(result.score).toBe(0) // clamped, not NaN
      expect(Number.isNaN(result.score)).toBe(false)
    })

    it('returns non-NaN for all-zero input', () => {
      const result = calculateScore({
        hardBrakes: 0, aggressiveAccels: 0, sharpTurns: 0, swerves: 0,
        touchEpochs: 0, screenInteractionSeconds: 0, durationSeconds: 0, distanceKm: 0,
        startTime: makeDate('tue', 12),
      })
      expect(result.score).toBe(100)
      expect(result.points).toBe(0)  // distanceFactor=0
      expect(Number.isNaN(result.points)).toBe(false)
    })

    it('rounds score to 1 decimal place', () => {
      // 1 AA (3) + 1 ST (2) + SIS 1/120 × 40 ≈ 5.333 → score ≈ 94.667 → rounded 94.7
      const result = calculateScore({
        ...BASE_INPUT,
        aggressiveAccels: 1,
        sharpTurns: 1,
        screenInteractionSeconds: 1,
        durationSeconds: 120,
      })
      expect(result.score).toBe(Math.round((100 - (3 + 2 + (1 / 120) * 40)) * 10) / 10)
    })

    it('full-session hand-held: screenInteractionSeconds equals durationSeconds', () => {
      const result = calculateScore({
        ...BASE_INPUT,
        screenInteractionSeconds: 120,
        durationSeconds: 120,
      })
      // penalty = (120/120)*40 = 40 → score = 60
      expect(result.score).toBe(60)
    })
  })
})

// ─── Active Interaction Penalties ────────────────────────────────────────────

describe('active interaction penalties', () => {
  it('touch epoch penalty: 5 epochs × 4 pts = 20 pts deduction', () => {
    const result = calculateScore({ ...BASE_INPUT, touchEpochs: 5 })
    expect(result.penalties).toBe(20)
    expect(result.score).toBe(80)
    expect(result.points).toBe(59.8) // 80 × 0.747 × 1.0
  })

  it('touch epoch penalty is fixed per epoch (no kinetic/speed weighting)', () => {
    const base5  = calculateScore({ ...BASE_INPUT, touchEpochs: 5 })
    const base10 = calculateScore({ ...BASE_INPUT, touchEpochs: 10 })
    expect(base10.penalties).toBeCloseTo(base5.penalties * 2, 5)
  })

  it('screen interaction penalty floored at 0 when SIS=0', () => {
    const result = calculateScore({ ...BASE_INPUT, screenInteractionSeconds: 0 })
    expect(result.penalties).toBe(0)
    expect(result.score).toBe(100)
  })

  it('combined touchEpochs + screenInteractionSeconds accumulate independently', () => {
    // 3 epochs (3×4=12 pts) + 30s of 60s hand-held ((30/60)×40=20 pts) = 32 pts
    const result = calculateScore({ ...BASE_INPUT, touchEpochs: 3, screenInteractionSeconds: 30, durationSeconds: 60 })
    expect(result.penalties).toBe(32)
    expect(result.score).toBe(68)
  })
})

// ─── scoreToGrade ─────────────────────────────────────────────────────────────

describe('scoreToGrade', () => {
  it('returns "excellent" for score >= 90', () => {
    expect(scoreToGrade(90)).toBe('excellent')
    expect(scoreToGrade(100)).toBe('excellent')
  })

  it('returns "good" for 75 <= score < 90', () => {
    expect(scoreToGrade(75)).toBe('good')
    expect(scoreToGrade(89)).toBe('good')
  })

  it('returns "fair" for 55 <= score < 75', () => {
    expect(scoreToGrade(55)).toBe('fair')
    expect(scoreToGrade(74)).toBe('fair')
  })

  it('returns "poor" for score < 55', () => {
    expect(scoreToGrade(54)).toBe('poor')
    expect(scoreToGrade(0)).toBe('poor')
  })
})

// ─── scoreToColor ─────────────────────────────────────────────────────────────

describe('scoreToColor', () => {
  it('returns green for score >= 90', () => {
    expect(scoreToColor(90)).toBe('#22c55e')
    expect(scoreToColor(100)).toBe('#22c55e')
  })

  it('returns lime for 75 <= score < 90', () => {
    expect(scoreToColor(75)).toBe('#84cc16')
    expect(scoreToColor(89)).toBe('#84cc16')
  })

  it('returns amber for 55 <= score < 75', () => {
    expect(scoreToColor(55)).toBe('#f59e0b')
    expect(scoreToColor(74)).toBe('#f59e0b')
  })

  it('returns red for score < 55', () => {
    expect(scoreToColor(54)).toBe('#ef4444')
    expect(scoreToColor(0)).toBe('#ef4444')
  })
})
