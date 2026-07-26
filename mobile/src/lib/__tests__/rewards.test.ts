import { rewardPrice, isDiscounted } from '@/lib/rewards'
import { LEVELS } from '@/lib/constants'

// The level discount is computed once, on the server, and sent as
// `effectiveCostPoints`. The client's only job is to show the same number on
// the card, in the confirmation sheet, and in the optimistic balance update.
// Two prices for one purchase is the shape of #29.

const listed = { costPoints: 1000 }

describe('rewardPrice', () => {
  it('uses the price the server calculated', () => {
    expect(rewardPrice({ costPoints: 1000, effectiveCostPoints: 750 })).toBe(750)
  })

  it('falls back to the list price when no viewer price was sent', () => {
    // A reward embedded in a voucher has no viewer, so no discounted price.
    expect(rewardPrice(listed)).toBe(1000)
  })

  it('does not treat a zero price as missing', () => {
    expect(rewardPrice({ costPoints: 1000, effectiveCostPoints: 0 })).toBe(0)
  })

  it('never derives a discount of its own', () => {
    // Same reward, same top-level ladder entry — still list price, because the
    // server did not send one. The client must not infer it from the level.
    expect(LEVELS[LEVELS.length - 1].discountPct).toBeGreaterThan(0)
    expect(rewardPrice(listed)).toBe(listed.costPoints)
  })
})

describe('isDiscounted', () => {
  it('is true only when the driver actually saves something', () => {
    expect(isDiscounted({ costPoints: 1000, effectiveCostPoints: 750 })).toBe(true)
    expect(isDiscounted({ costPoints: 1000, effectiveCostPoints: 1000 })).toBe(false)
    expect(isDiscounted(listed)).toBe(false)
  })
})

describe('the fallback ladder advertises only what the server enforces', () => {
  it('lists an unlock exactly where the discount moves', () => {
    LEVELS.forEach((lvl, i) => {
      const moved = i > 0 && lvl.discountPct !== LEVELS[i - 1].discountPct
      const kinds = lvl.unlocks.map(u => u.kind)
      expect(kinds.includes('discount')).toBe(moved)
    })
  })

  it('never presents the multiplier as an unlock — every level has one', () => {
    const kinds = LEVELS.flatMap(l => l.unlocks.map(u => u.kind))
    expect(kinds).not.toContain('multiplier')
  })

  it('matches each unlock value to the level it belongs to', () => {
    LEVELS.forEach(lvl => {
      lvl.unlocks
        .filter(u => u.kind === 'discount')
        .forEach(u => expect(u.value).toBe(lvl.discountPct))
    })
  })
})
