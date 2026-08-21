/**
 * @file utils.ts
 * @owner May (Mobile & Frontend UI Lead)
 * @brief Generic display formatting shared across screens and components.
 * Numbers, distances, durations, dates and relative times in Hebrew and English,
 * plus score/level to icon, colour and grade mappings.
 *
 * @description
 * Pure functions for formatting data for UI display:
 * - `formatPoints` / `formatDistance` / `formatDuration` / `formatScore` — number formatting
 * - `formatDate` / `formatTime` / `formatRelativeTime` — date formatting (Hebrew/English)
 * - `scoreToGrade` / `scoreToColor` / `scoreToIcon` / `levelToIcon` — score/level to display mapping
 * - `truncate` / `clamp` / `sleep` — general utilities
 *
 * @remarks No server calls — local functions only.
 */
import he from '@/i18n/he'
import en from '@/i18n/en'
import type { Language } from '@/types'

export function formatPoints(points: number, lang: Language = 'HE'): string {
  const rounded = Math.round(points)
  const dict = lang === 'HE' ? he : en
  return lang === 'HE'
    ? `${rounded.toLocaleString('he-IL')} ${dict.common.points}`
    : `${rounded.toLocaleString('en-US')} ${dict.common.points}`
}

export function formatDistance(km: number, lang: Language = 'HE'): string {
  const rounded = Math.round(km * 10) / 10
  const dict = lang === 'HE' ? he : en
  return `${rounded} ${dict.trip.km}`
}

export function formatDuration(seconds: number, lang: Language = 'HE'): string {
  const t = (lang === 'HE' ? he : en).time
  if (!seconds || isNaN(seconds)) return lang === 'HE' ? `0 ${t.minutesShort}` : `0${t.minutesShort}`
  const totalMins = Math.floor(seconds / 60)
  const secs = seconds % 60
  const hours = Math.floor(totalMins / 60)
  const mins = totalMins % 60
  if (totalMins === 0) return lang === 'HE' ? `${secs} ${t.secondsShort}` : `${secs}${t.secondsShort}`
  if (hours === 0) return lang === 'HE' ? `${mins} ${t.minutesShort}` : `${mins}${t.minutesShort}`
  return lang === 'HE' ? `${hours} ${t.hoursShort} ${mins} ${t.minutesShort}` : `${hours}${t.hoursShort} ${mins}${t.minutesShort}`
}

/**
 * Trip duration as h:mm, for the stat boxes on the trip screens.
 *
 * Separate from `formatDuration`, which stays worded ("3 דק'") for the live timer
 * on the active-trip screen and rounds nothing away. Here a finished trip under a
 * minute reads 0:01 rather than 0:00, since a saved trip did take some time.
 */
export function formatTripDuration(seconds: number): string {
  const safe = !seconds || isNaN(seconds) ? 0 : seconds
  const totalMins = Math.max(1, Math.round(safe / 60))
  const hours = Math.floor(totalMins / 60)
  const mins = totalMins % 60
  return `${hours}:${String(mins).padStart(2, '0')}`
}

/**
 * Trip distance as plain kilometres to two decimals — no unit.
 *
 * The stat box already carries a "distance" label under the value, so repeating
 * ק"מ there is noise. `formatDistance` keeps the unit for the places that show a
 * distance without a label of its own (trip cards, dashboard totals).
 */
export function formatTripDistance(km: number): string {
  const safe = !km || isNaN(km) ? 0 : km
  return safe.toFixed(2)
}

export function formatScore(score: number): string {
  return Math.round(score).toString()
}

export function formatDate(dateStr: string, lang: Language = 'HE'): string {
  if (!dateStr) return '';
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return '';

  return lang === 'HE'
    ? date.toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' })
    : date.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })
}

export function formatTime(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
}

export function formatRelativeTime(dateStr: string, lang: Language = 'HE'): string {
  const date      = new Date(dateStr)
  const now       = new Date()
  const diffMs    = now.getTime() - date.getTime()
  const diffMins  = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays  = Math.floor(diffHours / 24)
  const t = (lang === 'HE' ? he : en).time

  if (lang === 'HE') {
    if (diffMins < 1) return t.now
    if (diffMins < 60) return `${t.ago} ${diffMins} ${t.minutesShort}`
    if (diffHours < 24) return `${t.ago} ${diffHours} ${t.hoursWord}`
    if (diffDays < 7) return `${t.ago} ${diffDays} ${t.daysWord}`
    return formatDate(dateStr, 'HE')
  }
  if (diffMins < 1) return t.now
  if (diffMins < 60) return `${diffMins}${t.minutesShort} ${t.ago}`
  if (diffHours < 24) return `${diffHours}${t.hoursWord} ${t.ago}`
  if (diffDays < 7) return `${diffDays}${t.daysWord} ${t.ago}`
  return formatDate(dateStr, 'EN')
}

/** Presentation only — the score itself is computed server-side, never here. */
export function scoreToGrade(score: number): 'excellent' | 'good' | 'fair' | 'poor' {
  if (score >= 90) return 'excellent'
  if (score >= 75) return 'good'
  if (score >= 55) return 'fair'
  return 'poor'
}

export function scoreToColor(score: number): string {
  if (score >= 90) return '#22c55e'
  if (score >= 75) return '#84cc16'
  if (score >= 55) return '#f59e0b'
  return '#ef4444'
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

/**
 * True if the user's role is admin. Case-normalized because the real server sends the
 * UserRole enum's wire value uppercase ("ADMIN"), while the mobile UserRole type is lowercase.
 */
export function isAdmin(user: { role?: string } | null | undefined): boolean {
  return user?.role?.toUpperCase() === 'ADMIN'
}

/** Same case-normalization as isAdmin() — the real server sends role as "BUSINESS" (uppercase). */
export function isBusiness(user: { role?: string } | null | undefined): boolean {
  return user?.role?.toUpperCase() === 'BUSINESS'
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Returns the correctly localised string from a bilingual server object.
 * Used for voucher titles, level names, categories, and any object with titleHe/titleEn fields.
 */
export function localize(he: string, en: string | null | undefined, lang: Language): string {
  return lang === 'HE' ? he : (en || he)
}
