/**
 * @file cityLabel.ts
 * @owner May (Mobile & Frontend UI Lead)
 * @brief City display label — the one place a settlement becomes text. A city is a
 * reference row carrying a name per language (CAR-218), never a bare label, so screens
 * read it through here and switching language re-renders the name instead of leaving
 * whatever the server happened to store.
 *
 * Lives in lib/ rather than types/: types/ is aliases over the generated schema plus
 * the little the schema cannot express, and this is behaviour.
 */
import type { City } from '@/types'

export function cityLabel(city: City | null | undefined, lang: 'HE' | 'EN'): string {
  if (!city) return ''
  return lang === 'HE' ? city.nameHe : city.nameEn
}
