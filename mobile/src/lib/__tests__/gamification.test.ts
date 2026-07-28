import {
  levelDisplay,
  detectLevelChange,
  getProgressPercentage,
  allLevels,
} from '@/lib/gamification'
import { LEVELS, setLevels, getLevelByPoints } from '@/lib/constants'
import type { LevelConfig } from '@/types'

// This module used to own a 10-level ladder and a points multiplier, and
// AppContext multiplied the server's points by it — a parallel inflated
// economy that shrank on the next refresh (#29). The ladder also disagreed
// with the server's (#61). Both are gone: the server owns the ladder, the
// client only renders it.

describe('the client holds no ladder of its own', () => {
  it('exposes no way to derive a level from points', () => {
    const mod = require('@/lib/gamification')
    expect(mod.calculateLevel).toBeUndefined()
    expect(mod.GAMIFICATION_LEVELS).toBeUndefined()
  })

  it('exposes no multiplier — points arrive already multiplied', () => {
    const keys = allLevels().flatMap(l => Object.keys(l))
    expect(keys).not.toContain('multiplier')
    expect(keys).not.toContain('bonusMultiplier')
  })
})

describe('levelDisplay', () => {
  it('returns the config for a server-reported level', () => {
    const l = levelDisplay(3)
    expect(l.level).toBe(3)
    expect(l.minPoints).toBe(LEVELS[2].minPoints)
    expect(l.label).toBe(LEVELS[2].nameEn)
  })

  it('clamps out-of-range levels instead of throwing', () => {
    expect(levelDisplay(0).level).toBe(1)
    expect(levelDisplay(99).level).toBe(LEVELS[LEVELS.length - 1].level)
  })

  it('follows the server when setLevels replaces the fallback', () => {
    const original = [...LEVELS]
    const custom: LevelConfig[] = [
      { level: 1, name: 'א', nameEn: 'Renamed', minPoints: 0, maxPoints: 41,
        bonusMultiplier: 1, color: '#000', icon: 'leaf-outline', perks: [] },
      { level: 2, name: 'ב', nameEn: 'Second', minPoints: 42, maxPoints: 2147483647,
        bonusMultiplier: 1, color: '#000', icon: 'leaf-outline', perks: [] },
    ]
    try {
      setLevels(custom)
      expect(levelDisplay(1).label).toBe('Renamed')
      expect(getLevelByPoints(42)).toBe(2)
    } finally {
      setLevels(original)
    }
  })
})

describe('getProgressPercentage', () => {
  it('measures progress inside the level the server reported', () => {
    const l2 = LEVELS[1]
    expect(getProgressPercentage(l2.minPoints, 2)).toBe(0)
    const midway = Math.round((l2.minPoints + l2.maxPoints) / 2)
    expect(getProgressPercentage(midway, 2)).toBeCloseTo(50, -1)
  })

  it('uses the given level rather than re-deriving one from points', () => {
    // A demoted driver (#37) keeps their points but sits on a lower level, so
    // progress must be read against that level — deriving it from points would
    // silently undo the demotion.
    const pointsForTopLevel = LEVELS[LEVELS.length - 1].minPoints
    expect(getProgressPercentage(pointsForTopLevel, 4)).toBe(100)
  })

  it('returns 100 on the open-ended top level', () => {
    expect(getProgressPercentage(10 ** 9, LEVELS.length)).toBe(100)
  })

  it('clamps negative points to zero progress', () => {
    expect(getProgressPercentage(-500, 1)).toBe(0)
  })
})

describe('detectLevelChange', () => {
  it('returns null when the level is unchanged', () => {
    expect(detectLevelChange(4, 4)).toBeNull()
  })

  it('reports a promotion', () => {
    expect(detectLevelChange(3, 5)).toEqual({ from: 3, to: 5 })
  })

  it('reports a demotion too — levels can fall now (#37)', () => {
    expect(detectLevelChange(8, 6)).toEqual({ from: 8, to: 6 })
  })
})
