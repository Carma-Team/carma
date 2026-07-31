import { formatStockLabel, parseStockInput } from '@/lib/rewardStock'

// The dashboard used to render `stock` on its own. Because CAR-47 made stock an
// allocation the server never decrements, that number could not move: a business
// that allocated 5 units saw "5" whether none or all five had been claimed.

const UNLIMITED = 'ללא הגבלה'

describe('formatStockLabel', () => {
  it('shows what is left out of what was allocated', () => {
    expect(formatStockLabel(5, 3, UNLIMITED)).toBe('3/5')
  })

  it('shows a sold-out reward as 0 of its allocation', () => {
    expect(formatStockLabel(5, 0, UNLIMITED)).toBe('0/5')
  })

  it('shows an uncapped reward as unlimited', () => {
    expect(formatStockLabel(null, null, UNLIMITED)).toBe(UNLIMITED)
  })

  it('does not read a cap of 0 as unlimited — the business set it deliberately', () => {
    expect(formatStockLabel(0, 0, UNLIMITED)).toBe('0/0')
  })

  it('falls back to the allocation when availability is missing', () => {
    // The server derives one from the other, so a capped reward always carries a
    // number here. If that ever stops being true, showing the whole allocation
    // beats rendering the string "null" at the owner.
    expect(formatStockLabel(5, null, UNLIMITED)).toBe('5/5')
  })
})

describe('parseStockInput', () => {
  it('reads a blank field as no cap', () => {
    expect(parseStockInput('')).toEqual({ valid: true, stock: null })
  })

  it('reads whitespace as blank, not as zero', () => {
    // `Number('   ')` is 0, which would create a reward born sold out.
    expect(parseStockInput('   ')).toEqual({ valid: true, stock: null })
  })

  it('keeps a real number as the cap', () => {
    expect(parseStockInput('5')).toEqual({ valid: true, stock: 5 })
  })

  it('ignores padding around a real number', () => {
    // The screen trimmed before parsing; moving the rule here must not change that.
    expect(parseStockInput(' 5 ')).toEqual({ valid: true, stock: 5 })
  })

  it('keeps a deliberate cap of zero', () => {
    expect(parseStockInput('0')).toEqual({ valid: true, stock: 0 })
  })

  it('rejects anything that is not a whole non-negative number', () => {
    expect(parseStockInput('abc')).toEqual({ valid: false })
    expect(parseStockInput('2.5')).toEqual({ valid: false })
    expect(parseStockInput('-1')).toEqual({ valid: false })
  })
})
