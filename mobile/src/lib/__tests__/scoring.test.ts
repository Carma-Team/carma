import {
  scoreToGrade,
  scoreToColor,
} from '@/lib/scoring'

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
