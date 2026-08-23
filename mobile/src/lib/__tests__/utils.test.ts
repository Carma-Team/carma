import { scoreToGrade, scoreToColor, toE164 } from '@/lib/utils'

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

// ─── toE164 ───────────────────────────────────────────────────────────────────

describe('toE164', () => {
  it('turns a local Israeli number into E.164', () => {
    expect(toE164('050-123-4567')).toBe('+972501234567')
    expect(toE164('050 1234567')).toBe('+972501234567')
  })

  it('leaves a number that is already E.164 alone', () => {
    expect(toE164('+972501234567')).toBe('+972501234567')
  })

  it('returns null for anything the server would answer with a 422', () => {
    expect(toE164('abc')).toBeNull()
    expect(toE164('0501')).toBeNull()         // 6 digits once +972 replaces the 0, one under the floor
    expect(toE164('972501234567')).toBeNull() // no leading + and no leading 0
  })
})
