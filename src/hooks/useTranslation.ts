'use client'

import { useCallback } from 'react'
import { useApp } from '@/context/AppContext'
import he from '@/i18n/he'
import en from '@/i18n/en'

type DeepRecord = { [key: string]: DeepRecord | string }

function getNestedValue(obj: DeepRecord, path: string): string {
  const keys = path.split('.')
  let current: DeepRecord | string = obj
  for (const key of keys) {
    if (typeof current === 'string') return path
    if (!(key in current)) return path
    current = (current as DeepRecord)[key]
  }
  return typeof current === 'string' ? current : path
}

export function useT() {
  const { lang, setLang } = useApp()

  const translations = (lang === 'he' ? he : en) as unknown as DeepRecord

  const t = useCallback(
    (key: string, fallback?: string): string => {
      const value = getNestedValue(translations, key)
      if (value === key) return fallback ?? key
      return value
    },
    [translations]
  )

  return { t, lang, setLang }
}

export default useT
