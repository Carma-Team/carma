import {
  calculateLevel,
  detectLevelUp,
  getProgressPercentage,
  GAMIFICATION_LEVELS,
} from '@/lib/driving-sdk/utils/gamification'

// ─── calculateLevel ───────────────────────────────────────────────────────────

describe('calculateLevel', () => {
  it('returns level 1 at 0 points', () => {
    expect(calculateLevel(0).level).toBe(1)
  })

  it('returns level 1 at the ceiling (999 pts)', () => {
    expect(calculateLevel(999).level).toBe(1)
  })

  it('returns level 2 at the floor (1000 pts)', () => {
    expect(calculateLevel(1000).level).toBe(2)
  })

  it('returns level 2 at mid-range (1750 pts)', () => {
    expect(calculateLevel(1750).level).toBe(2)
  })

  it('returns level 2 at ceiling (2499 pts)', () => {
    expect(calculateLevel(2499).level).toBe(2)
  })

  it('returns level 3 at the floor (2500 pts)', () => {
    expect(calculateLevel(2500).level).toBe(3)
  })

  it('returns level 3 and sets unlocksFeature to Tier 1 Rewards', () => {
    const l = calculateLevel(3000)
    expect(l.level).toBe(3)
    expect(l.unlocksFeature).toBe('Tier 1 Rewards')
  })

  it('returns level 4 at the floor (5000 pts)', () => {
    expect(calculateLevel(5000).level).toBe(4)
  })

  it('returns level 5 at the floor (8000 pts)', () => {
    expect(calculateLevel(8000).level).toBe(5)
  })

  it('returns level 5 and sets unlocksFeature to VIP Marketplace', () => {
    const l = calculateLevel(10000)
    expect(l.level).toBe(5)
    expect(l.unlocksFeature).toBe('VIP Marketplace')
  })

  it('returns level 5 at its ceiling (11999 pts)', () => {
    expect(calculateLevel(11999).level).toBe(5)
  })

  it('returns level 10 (max) at 12000 pts', () => {
    expect(calculateLevel(12000).level).toBe(10)
  })

  it('returns level 10 for arbitrarily large point totals', () => {
    expect(calculateLevel(999_999).level).toBe(10)
  })

  it('clamps negative input to level 1 (no crash, no NaN)', () => {
    const l = calculateLevel(-100)
    expect(l.level).toBe(1)
  })

  it('level 10 has 1.5× multiplier', () => {
    expect(calculateLevel(12000).multiplier).toBe(1.5)
  })

  it('level 1 has 1.0× multiplier', () => {
    expect(calculateLevel(0).multiplier).toBe(1.0)
  })

  it('multipliers increase monotonically through all levels', () => {
    for (let i = 1; i < GAMIFICATION_LEVELS.length; i++) {
      expect(GAMIFICATION_LEVELS[i].multiplier).toBeGreaterThan(
        GAMIFICATION_LEVELS[i - 1].multiplier
      )
    }
  })
})

// ─── getProgressPercentage ────────────────────────────────────────────────────

describe('getProgressPercentage', () => {
  it('returns 0 at 0 points (start of level 1)', () => {
    expect(getProgressPercentage(0)).toBe(0)
  })

  it('returns ~50% at the midpoint of level 1 (~500 pts)', () => {
    // Level 1: 0–999, midpoint ≈ 499, progress = 499/999 ≈ 50%
    const pct = getProgressPercentage(499)
    expect(pct).toBeGreaterThanOrEqual(49)
    expect(pct).toBeLessThanOrEqual(51)
  })

  it('returns 100% at the ceiling of level 1 (999 pts)', () => {
    expect(getProgressPercentage(999)).toBe(100)
  })

  it('returns 0% at the floor of level 2 (1000 pts)', () => {
    expect(getProgressPercentage(1000)).toBe(0)
  })

  it('returns 100% at max level (level 10)', () => {
    expect(getProgressPercentage(12000)).toBe(100)
    expect(getProgressPercentage(50000)).toBe(100)
  })

  it('clamps negative input to 0%', () => {
    expect(getProgressPercentage(-500)).toBe(0)
  })

  it('never exceeds 100', () => {
    const extremes = [0, 999, 1000, 2499, 2500, 4999, 5000, 7999, 8000, 11999, 12000, 99999]
    extremes.forEach(pts => {
      expect(getProgressPercentage(pts)).toBeLessThanOrEqual(100)
    })
  })

  it('returns a non-NaN integer for all boundary values', () => {
    const boundaries = GAMIFICATION_LEVELS.flatMap(l => [l.minPoints, l.maxPoints === Infinity ? 99999 : l.maxPoints])
    boundaries.forEach(pts => {
      const result = getProgressPercentage(pts)
      expect(Number.isNaN(result)).toBe(false)
      expect(Number.isInteger(result)).toBe(true)
    })
  })
})

// ─── detectLevelUp ────────────────────────────────────────────────────────────

describe('detectLevelUp', () => {
  it('returns null when points stay within the same level', () => {
    expect(detectLevelUp(0, 500)).toBeNull()
    expect(detectLevelUp(500, 999)).toBeNull()
    expect(detectLevelUp(1000, 2000)).toBeNull()
  })

  it('detects level up from 1 → 2 at the boundary', () => {
    const event = detectLevelUp(999, 1000)
    expect(event).not.toBeNull()
    expect(event!.from).toBe(1)
    expect(event!.to).toBe(2)
    expect(event!.newMultiplier).toBe(1.05)
    expect(event!.unlocksFeature).toBeUndefined()
  })

  it('detects level up from 2 → 3 (unlocks Tier 1 Rewards)', () => {
    const event = detectLevelUp(2499, 2500)
    expect(event!.from).toBe(2)
    expect(event!.to).toBe(3)
    expect(event!.unlocksFeature).toBe('Tier 1 Rewards')
  })

  it('detects level up from 4 → 5 (unlocks VIP Marketplace)', () => {
    const event = detectLevelUp(7999, 8000)
    expect(event!.from).toBe(4)
    expect(event!.to).toBe(5)
    expect(event!.unlocksFeature).toBe('VIP Marketplace')
    expect(event!.newMultiplier).toBe(1.20)
  })

  it('detects level up from 5 → 10 (max tier)', () => {
    const event = detectLevelUp(11999, 12000)
    expect(event!.from).toBe(5)
    expect(event!.to).toBe(10)
    expect(event!.newMultiplier).toBe(1.50)
  })

  it('returns null when both values are at max level', () => {
    expect(detectLevelUp(12000, 99999)).toBeNull()
  })

  it('handles negative previousPoints safely (clamps to level 1)', () => {
    const event = detectLevelUp(-500, 1000)
    expect(event!.from).toBe(1)
    expect(event!.to).toBe(2)
  })

  it('detects a multi-tier jump (level 1 → level 5 in one trip)', () => {
    const event = detectLevelUp(0, 8000)
    expect(event!.from).toBe(1)
    expect(event!.to).toBe(5)
  })
})
