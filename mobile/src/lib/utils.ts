/**
 * @fileoverview General display formatting utilities
 * @module lib/utils
 *
 * @description
 * Pure functions for formatting data for UI display:
 * - `formatPoints` / `formatDistance` / `formatDuration` / `formatScore` — number formatting
 * - `formatDate` / `formatTime` / `formatRelativeTime` — date formatting (Hebrew/English)
 * - `scoreToIcon` / `levelToIcon` — score/level to icon mapping
 * - `truncate` / `clamp` / `sleep` — general utilities
 *
 * @remarks No server calls — local functions only.
 */
import he from '@/i18n/he'
import en from '@/i18n/en'

export function formatPoints(points: number, lang: 'he' | 'en' = 'he'): string {
  const rounded = Math.round(points)
  const dict = lang === 'he' ? he : en
  return lang === 'he'
    ? `${rounded.toLocaleString('he-IL')} ${dict.common.points}`
    : `${rounded.toLocaleString('en-US')} ${dict.common.points}`
}

export function formatDistance(km: number, lang: 'he' | 'en' = 'he'): string {
  const rounded = Math.round(km * 10) / 10
  const dict = lang === 'he' ? he : en
  return `${rounded} ${dict.trip.km}`
}

export function formatDuration(seconds: number, lang: 'he' | 'en' = 'he'): string {
  const t = (lang === 'he' ? he : en).time
  if (!seconds || isNaN(seconds)) return lang === 'he' ? `0 ${t.minutesShort}` : `0${t.minutesShort}`
  const totalMins = Math.floor(seconds / 60)
  const secs = seconds % 60
  const hours = Math.floor(totalMins / 60)
  const mins = totalMins % 60
  if (totalMins === 0) return lang === 'he' ? `${secs} ${t.secondsShort}` : `${secs}${t.secondsShort}`
  if (hours === 0) return lang === 'he' ? `${mins} ${t.minutesShort}` : `${mins}${t.minutesShort}`
  return lang === 'he' ? `${hours} ${t.hoursShort} ${mins} ${t.minutesShort}` : `${hours}${t.hoursShort} ${mins}${t.minutesShort}`
}

export function formatScore(score: number): string {
  return Math.round(score).toString()
}

export function formatDate(dateStr: string, lang: 'he' | 'en' = 'he'): string {
  if (!dateStr) return '';
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return '';

  return lang === 'he'
    ? date.toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' })
    : date.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })
}

export function formatTime(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
}

export function formatRelativeTime(dateStr: string, lang: 'he' | 'en' = 'he'): string {
  const date      = new Date(dateStr)
  const now       = new Date()
  const diffMs    = now.getTime() - date.getTime()
  const diffMins  = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays  = Math.floor(diffHours / 24)
  const t = (lang === 'he' ? he : en).time

  if (lang === 'he') {
    if (diffMins < 1) return t.now
    if (diffMins < 60) return `${t.ago} ${diffMins} ${t.minutesShort}`
    if (diffHours < 24) return `${t.ago} ${diffHours} ${t.hoursWord}`
    if (diffDays < 7) return `${t.ago} ${diffDays} ${t.daysWord}`
    return formatDate(dateStr, 'he')
  }
  if (diffMins < 1) return t.now
  if (diffMins < 60) return `${diffMins}${t.minutesShort} ${t.ago}`
  if (diffHours < 24) return `${diffHours}${t.hoursWord} ${t.ago}`
  if (diffDays < 7) return `${diffDays}${t.daysWord} ${t.ago}`
  return formatDate(dateStr, 'en')
}

export function scoreToIcon(score: number): string {
  if (score >= 90) return 'star'
  if (score >= 75) return 'checkmark-circle'
  if (score >= 55) return 'alert-circle'
  return 'close-circle'
}

export function levelToIcon(level: number): string {
  const icons = [
    'leaf-outline',             // 1 — beginner
    'compass-outline',          // 2 — finding your way
    'aperture-outline',         // 3 — developing precision
    'flash-outline',            // 4 — gaining energy
    'shield-checkmark-outline', // 5 — safety aware
    'flame-outline',            // 6 — on fire
    'star-outline',             // 7 — rising star
    'diamond-outline',          // 8 — elite
    'trophy-outline',           // 9 — champion
    'ribbon-outline',           // 10 — legend
  ]
  return icons[Math.max(0, Math.min(level - 1, icons.length - 1))]
}

export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen - 1) + '…'
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Returns the correctly localised string from a bilingual server object.
 * Used for voucher titles, level names, categories, and any object with titleHe/titleEn fields.
 */
export function localize(he: string, en: string | null | undefined, lang: string): string {
  return lang === 'he' ? he : (en || he)
}
