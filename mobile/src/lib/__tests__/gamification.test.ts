import {
  calculateLevel,
  detectLevelUp,
  getProgressPercentage,
  GAMIFICATION_LEVELS,
} from '@/lib/gamification'

// Official 10-level map (minPoints):
// L1=0, L2=1000, L3=2500, L4=4500, L5=6500,
// L6=8500, L7=10500, L8=13000, L9=16000, L10=20000

// ─── calculateLevel ───────────────────────────────────────────────────────────

describe('calculateLevel', () => {
  it('returns level 1 at 0 pts', () => {
    expect(calculateLevel(0).level).toBe(1)
    expect(calculateLevel(0).label).toBe('Newbie / Beginner')
  })

  it('returns level 1 at its ceiling (999 pts)', () => {
    expect(calculateLevel(999).level).toBe(1)
  })

  it('returns level 2 at its floor (1000 pts)', () => {
    expect(calculateLevel(1000).level).toBe(2)
    expect(calculateLevel(1000).label).toBe('Novice Driver')
  })

  it('returns level 2 at its ceiling (2499 pts)', () => {
    expect(calculateLevel(2499).level).toBe(2)
  })

  it('returns level 3 at its floor (2500 pts)', () => {
    expect(calculateLevel(2500).level).toBe(3)
    expect(calculateLevel(2500).label).toBe('Safe Driver')
  })

  it('returns level 3 at its ceiling (4499 pts)', () => {
    expect(calculateLevel(4499).level).toBe(3)
  })

  it('returns level 4 at its floor (4500 pts)', () => {
    expect(calculateLevel(4500).level).toBe(4)
    expect(calculateLevel(4500).label).toBe('Consistent Driver')
  })

  it('returns level 4 at its ceiling (6499 pts)', () => {
    expect(calculateLevel(6499).level).toBe(4)
  })

  it('returns level 5 at its floor (6500 pts)', () => {
    expect(calculateLevel(6500).level).toBe(5)
    expect(calculateLevel(6500).label).toBe('Pro Driver')
  })

  it('returns level 5 at its ceiling (8499 pts)', () => {
    expect(calculateLevel(8499).level).toBe(5)
  })

  it('returns level 6 at its floor (8500 pts)', () => {
    expect(calculateLevel(8500).level).toBe(6)
    expect(calculateLevel(8500).label).toBe('Expert Driver')
  })

  it('returns level 6 at its ceiling (10499 pts)', () => {
    expect(calculateLevel(10499).level).toBe(6)
  })

  it('returns level 7 at its floor (10500 pts)', () => {
    expect(calculateLevel(10500).level).toBe(7)
    expect(calculateLevel(10500).label).toBe('Master Driver')
  })

  it('returns level 7 at its ceiling (12999 pts)', () => {
    expect(calculateLevel(12999).level).toBe(7)
  })

  it('returns level 8 at its floor (13000 pts)', () => {
    expect(calculateLevel(13000).level).toBe(8)
    expect(calculateLevel(13000).label).toBe('Elite Driver')
  })

  it('returns level 8 at its ceiling (15999 pts)', () => {
    expect(calculateLevel(15999).level).toBe(8)
  })

  it('returns level 9 at its floor (16000 pts)', () => {
    expect(calculateLevel(16000).level).toBe(9)
    expect(calculateLevel(16000).label).toBe('Champion Driver')
  })

  it('returns level 9 at its ceiling (19999 pts)', () => {
    expect(calculateLevel(19999).level).toBe(9)
  })

  it('returns level 10 at its floor (20000 pts)', () => {
    expect(calculateLevel(20000).level).toBe(10)
    expect(calculateLevel(20000).label).toBe('Model Driver')
  })

  it('returns level 10 for arbitrarily large totals', () => {
    expect(calculateLevel(999_999).level).toBe(10)
  })

  it('clamps negative input to level 1', () => {
    expect(calculateLevel(-1).level).toBe(1)
    expect(calculateLevel(-9999).level).toBe(1)
  })

  it('level 10 maxPoints is Infinity', () => {
    expect(calculateLevel(20000).maxPoints).toBe(Infinity)
  })

  it('multipliers increase monotonically across all 10 levels', () => {
    for (let i = 1; i < GAMIFICATION_LEVELS.length; i++) {
      expect(GAMIFICATION_LEVELS[i].multiplier).toBeGreaterThan(
        GAMIFICATION_LEVELS[i - 1].multiplier
      )
    }
  })

  it('has exactly 10 levels', () => {
    expect(GAMIFICATION_LEVELS.length).toBe(10)
  })

  it('level 1 multiplier is 1.0', () => {
    expect(calculateLevel(0).multiplier).toBe(1.0)
  })

  it('level 10 multiplier is 1.5', () => {
    expect(calculateLevel(20000).multiplier).toBe(1.5)
  })
})

// ─── getProgressPercentage ────────────────────────────────────────────────────

describe('getProgressPercentage', () => {
  it('returns 0% at the start of level 1 (0 pts)', () => {
    expect(getProgressPercentage(0)).toBe(0)
  })

  it('returns 100% at the ceiling of level 1 (999 pts)', () => {
    expect(getProgressPercentage(999)).toBe(100)
  })

  it('returns 0% at the floor of level 2 (1000 pts)', () => {
    expect(getProgressPercentage(1000)).toBe(0)
  })

  it('returns ~50% at the midpoint of level 2 (~1750 pts)', () => {
    // Level 2: 1000–2499, range=1499, midpoint≈1749
    const pct = getProgressPercentage(1749)
    expect(pct).toBeGreaterThanOrEqual(49)
    expect(pct).toBeLessThanOrEqual(51)
  })

  it('returns 0% at the floor of level 4 (4500 pts)', () => {
    expect(getProgressPercentage(4500)).toBe(0)
  })

  it('returns 0% at the floor of level 5 (6500 pts)', () => {
    expect(getProgressPercentage(6500)).toBe(0)
  })

  it('returns 100% at any level 10 value (max level, no ceiling)', () => {
    expect(getProgressPercentage(20000)).toBe(100)
    expect(getProgressPercentage(50000)).toBe(100)
  })

  it('clamps negative input to 0%', () => {
    expect(getProgressPercentage(-500)).toBe(0)
  })

  it('never returns a value outside [0, 100]', () => {
    const checkpoints = [
      0, 999, 1000, 2499, 2500, 4499, 4500, 6499, 6500, 8499,
      8500, 10499, 10500, 12999, 13000, 15999, 16000, 19999, 20000, 99999,
    ]
    checkpoints.forEach(pts => {
      const result = getProgressPercentage(pts)
      expect(result).toBeGreaterThanOrEqual(0)
      expect(result).toBeLessThanOrEqual(100)
    })
  })

  it('returns non-NaN integers for all level boundary values', () => {
    GAMIFICATION_LEVELS.forEach(l => {
      [l.minPoints, l.maxPoints === Infinity ? 99999 : l.maxPoints].forEach(pts => {
        const result = getProgressPercentage(pts)
        expect(Number.isNaN(result)).toBe(false)
        expect(Number.isInteger(result)).toBe(true)
      })
    })
  })
})

// ─── detectLevelUp ────────────────────────────────────────────────────────────

describe('detectLevelUp', () => {
  it('returns null when points stay within level 1', () => {
    expect(detectLevelUp(0, 999)).toBeNull()
  })

  it('returns null when both values are at level 10', () => {
    expect(detectLevelUp(20000, 99999)).toBeNull()
  })

  it('returns null when values are in the same mid-range level', () => {
    expect(detectLevelUp(8500, 10000)).toBeNull() // both level 6
  })

  it('detects 1 → 2 at the exact boundary (999 → 1000)', () => {
    const evt = detectLevelUp(999, 1000)
    expect(evt).not.toBeNull()
    expect(evt!.from).toBe(1)
    expect(evt!.to).toBe(2)
    expect(evt!.newMultiplier).toBe(1.05)
  })

  it('detects 2 → 3 at the exact boundary (2499 → 2500)', () => {
    const evt = detectLevelUp(2499, 2500)
    expect(evt!.from).toBe(2)
    expect(evt!.to).toBe(3)
    expect(evt!.newMultiplier).toBe(1.10)
  })

  it('detects 3 → 4 at the exact boundary (4499 → 4500)', () => {
    const evt = detectLevelUp(4499, 4500)
    expect(evt!.from).toBe(3)
    expect(evt!.to).toBe(4)
    expect(evt!.newMultiplier).toBe(1.15)
  })

  it('detects 4 → 5 at the exact boundary (6499 → 6500)', () => {
    const evt = detectLevelUp(6499, 6500)
    expect(evt!.from).toBe(4)
    expect(evt!.to).toBe(5)
    expect(evt!.newMultiplier).toBe(1.20)
  })

  it('detects 5 → 6 at the exact boundary (8499 → 8500)', () => {
    const evt = detectLevelUp(8499, 8500)
    expect(evt!.from).toBe(5)
    expect(evt!.to).toBe(6)
    expect(evt!.newMultiplier).toBe(1.25)
  })

  it('detects 6 → 7 at the exact boundary (10499 → 10500)', () => {
    const evt = detectLevelUp(10499, 10500)
    expect(evt!.from).toBe(6)
    expect(evt!.to).toBe(7)
    expect(evt!.newMultiplier).toBe(1.30)
  })

  it('detects 7 → 8 at the exact boundary (12999 → 13000)', () => {
    const evt = detectLevelUp(12999, 13000)
    expect(evt!.from).toBe(7)
    expect(evt!.to).toBe(8)
    expect(evt!.newMultiplier).toBe(1.35)
  })

  it('detects 8 → 9 at the exact boundary (15999 → 16000)', () => {
    const evt = detectLevelUp(15999, 16000)
    expect(evt!.from).toBe(8)
    expect(evt!.to).toBe(9)
    expect(evt!.newMultiplier).toBe(1.40)
  })

  it('detects 9 → 10 at the exact boundary (19999 → 20000)', () => {
    const evt = detectLevelUp(19999, 20000)
    expect(evt!.from).toBe(9)
    expect(evt!.to).toBe(10)
    expect(evt!.newMultiplier).toBe(1.50)
  })

  it('detects a multi-tier jump (level 1 → level 7 in one trip)', () => {
    const evt = detectLevelUp(0, 10500)
    expect(evt!.from).toBe(1)
    expect(evt!.to).toBe(7)
  })

  it('handles negative previousPoints safely (clamps to level 1)', () => {
    const evt = detectLevelUp(-500, 1000)
    expect(evt!.from).toBe(1)
    expect(evt!.to).toBe(2)
  })
})

// ─── Multi-Level Leap: Level 1 → Level 4 single-sync scenario ────────────────
//
// Mirrors the AppContext processEndTrip + SyncManager.onTripSynced flow:
// A brand-new user (0 pts, L1, ×1.00) earns a large offline trip that arrives
// in a single server sync.  The accumulated total lands cleanly in Level 4.
// Tests cover level detection, level-up event shape, progress %, the AsyncStorage
// JSON round-trip that loadInitialData uses on cold-start rehydration, and the
// multiplier benefit visible on the next trip after the jump.

describe('multi-level leap — Level 1 → Level 4 single-sync scenario', () => {
  const PREV_TOTAL = 0          // fresh user — Level 1 (×1.00)
  const TRIP_RAW   = 4600       // raw points as returned by the server on trip save
  const L1_MULT    = calculateLevel(PREV_TOTAL).multiplier  // 1.00
  const EARNED     = Math.round(TRIP_RAW * L1_MULT)         // 4600
  const NEW_TOTAL  = PREV_TOTAL + EARNED                     // 4600 → inside L4 (4500–6499)

  it('calculateLevel resolves Level 4 at the post-sync total', () => {
    const level = calculateLevel(NEW_TOTAL)
    expect(level.level).toBe(4)
    expect(level.label).toBe('Consistent Driver')
    expect(level.multiplier).toBe(1.15)
    expect(level.minPoints).toBe(4500)
    expect(level.maxPoints).toBe(6499)
  })

  it('detectLevelUp emits from=1, to=4, newMultiplier=1.15', () => {
    const evt = detectLevelUp(PREV_TOTAL, NEW_TOTAL)
    expect(evt).not.toBeNull()
    expect(evt!.from).toBe(1)
    expect(evt!.to).toBe(4)
    expect(evt!.newMultiplier).toBeCloseTo(1.15)
  })

  it('getProgressPercentage places 4600 pts ~5% into the Level 4 range', () => {
    // L4 range: 4500–6499 (width=1999). 4600 is 100 pts in → ~5 %.
    const pct = getProgressPercentage(NEW_TOTAL)
    expect(pct).toBeGreaterThanOrEqual(4)
    expect(pct).toBeLessThanOrEqual(6)
  })

  it('AsyncStorage round-trip: JSON-serialised user rehydrates to Level 4 via calculateLevel', () => {
    // AppContext writes `{ totalPoints, level: calculateLevel(totalPoints) }` to AsyncStorage.
    // On cold-start, loadInitialData re-derives the level from totalPoints (not the stored object).
    // Both paths must converge on Level 4.
    const storedUser = { id: 'u1', totalPoints: NEW_TOTAL, level: calculateLevel(NEW_TOTAL) }
    const rehydrated  = calculateLevel((JSON.parse(JSON.stringify(storedUser)) as typeof storedUser).totalPoints)
    expect(rehydrated.level).toBe(4)
    expect(rehydrated.multiplier).toBe(1.15)
    expect(rehydrated.label).toBe('Consistent Driver')
  })

  it('next trip at Level 4 earns 15 % more than an equivalent trip at Level 1', () => {
    const rawPoints  = 200
    const earnedAtL1 = Math.round(rawPoints * calculateLevel(PREV_TOTAL).multiplier) // 200
    const earnedAtL4 = Math.round(rawPoints * calculateLevel(NEW_TOTAL).multiplier)  // 230
    expect(earnedAtL1).toBe(200)
    expect(earnedAtL4).toBe(230)
    expect(earnedAtL4 - earnedAtL1).toBe(30) // exactly 15 % of 200
  })

  it('all boundary points between L1 and the final total fall within their declared level range', () => {
    // Verifies no off-by-one across the 3 tier boundaries crossed during the jump.
    const checkpoints = [0, 999, 1000, 2499, 2500, 4499, NEW_TOTAL]
    checkpoints.forEach(pts => {
      const level = calculateLevel(pts)
      expect(pts).toBeGreaterThanOrEqual(level.minPoints)
      if (level.maxPoints !== Infinity) {
        expect(pts).toBeLessThanOrEqual(level.maxPoints)
      }
    })
  })
})
