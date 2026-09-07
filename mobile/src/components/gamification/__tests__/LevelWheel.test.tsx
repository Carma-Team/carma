/**
 * The perk line, which is where the server's Hebrew used to reach an English screen.
 *
 * `LevelOut.perks` is prose the server writes in Hebrew with no language parameter
 * (CAR-249), and the wheel rendered it verbatim. What these tests pin is that the
 * line is now built from `bonusMultiplier` and the app's own wording, so nothing the
 * server writes can appear here.
 */
import React from 'react'
import { render, screen } from '@testing-library/react-native'
import { LevelWheel } from '@/components/gamification/LevelWheel'
import he from '@/i18n/he'
import en from '@/i18n/en'
import type { LevelConfig, Language } from '@/types'

// `t` reads the language from the context, not from the component's own prop, so the
// mock is what decides which dictionary the perk line is built from.
let mockLang: Language = 'HE'
jest.mock('@/context/AppContext', () => ({ useApp: () => ({ lang: mockLang }) }))

const level = (over: Partial<LevelConfig> = {}): LevelConfig => ({
  level: 3,
  name: 'מרוכז',
  nameEn: 'Focused',
  minPoints: 1500,
  maxPoints: 3499,
  bonusMultiplier: 1.25,
  color: '#16a34a',
  icon: 'aperture-outline',
  // Still what the server sends. Nothing may render it.
  perks: ['מכפיל נקודות x1.25'],
  ...over,
})

// The driver sits on level 1, so level 3 is centred as a level they have not reached —
// the only state in which the wheel shows a perk line at all.
const renderWheel = (levels: LevelConfig[], lang: Language = 'HE') => {
  mockLang = lang
  return render(<LevelWheel levels={levels} currentLevel={1} currentPoints={0} lang={lang} />)
}

afterEach(() => { mockLang = 'HE' })

describe('LevelWheel perk line', () => {
  it('builds the multiplier from the number, in the app language', () => {
    renderWheel([level()], 'HE')
    expect(screen.getByText(`${he.roadmap.pointsMultiplier} x1.25`)).toBeTruthy()
  })

  it('never renders the string the server sent', () => {
    // A multiplier the level does not have, so a match could only come from `perks`.
    // Under HE the app's own line reads the same words, which is why the number is
    // what separates them.
    renderWheel([level({ perks: ['מכפיל נקודות x9.99'] })])
    expect(screen.queryByText('מכפיל נקודות x9.99')).toBeNull()
  })

  it('reads English when the app does', () => {
    renderWheel([level()], 'EN')
    expect(screen.getByText(`${en.roadmap.pointsMultiplier} x1.25`)).toBeTruthy()
    expect(screen.queryByText(new RegExp(he.roadmap.pointsMultiplier))).toBeNull()
  })

  it('says nothing for a level that multiplies nothing', () => {
    renderWheel([level({ bonusMultiplier: 1, perks: [] })])
    expect(screen.queryByText(new RegExp(he.roadmap.pointsMultiplier))).toBeNull()
  })
})
