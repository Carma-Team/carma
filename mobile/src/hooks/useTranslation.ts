/**
 * @fileoverview Localisation hook — useTranslation
 * @module hooks/useTranslation
 *
 * @description
 * Reads the user language from AppContext and returns a `t(key)` function for string lookup.
 * Supports dot-notation for nested keys (e.g. `t('auth.errors.emailRequired')`).
 * Translation files: `i18n/he.ts` (Hebrew), `i18n/en.ts` (English).
 *
 * @remarks No server calls — local only.
 */
import { useApp } from '@/context/AppContext'
import he from '@/i18n/he'
import en from '@/i18n/en'
import type { TranslationMap } from '@/i18n/he'

function getNestedValue(obj: Record<string, unknown>, path: string): string {
  const keys = path.split('.')
  let current: unknown = obj
  for (const key of keys) {
    if (current && typeof current === 'object' && key in (current as object)) {
      current = (current as Record<string, unknown>)[key]
    } else {
      return path
    }
  }
  return typeof current === 'string' ? current : path
}

export function useTranslation() {
  const { lang, setLang } = useApp()
  const translations: TranslationMap = lang === 'HE' ? he : en

  function t(key: string): string {
    return getNestedValue(translations as unknown as Record<string, unknown>, key)
  }

  return { t, lang, setLang }
}

// Alias used in web version
export const useT = useTranslation
