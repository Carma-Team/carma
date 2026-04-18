import { useApp } from '@/context/AppContext'
import he from '@/i18n/he'
import en from '@/i18n/en'

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }

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
  const translations = lang === 'he' ? he : en as unknown as typeof he

  function t(key: string): string {
    return getNestedValue(translations as unknown as Record<string, unknown>, key)
  }

  return { t, lang, setLang }
}

// Alias used in web version
export const useT = useTranslation
