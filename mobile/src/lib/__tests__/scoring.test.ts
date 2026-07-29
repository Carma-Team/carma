import {
  getRiskMultiplier,
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
