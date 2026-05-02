export function formatPoints(points: number, lang: 'he' | 'en' = 'he'): string {
  const rounded = Math.round(points)
  return lang === 'he' ? `${rounded.toLocaleString('he-IL')} נקודות` : `${rounded.toLocaleString('en-US')} pts`
}

export function formatDistance(km: number, lang: 'he' | 'en' = 'he'): string {
  const rounded = Math.round(km * 10) / 10
  return lang === 'he' ? `${rounded} ק"מ` : `${rounded} km`
}

export function formatDuration(seconds: number, lang: 'he' | 'en' = 'he'): string {
  if (!seconds || isNaN(seconds)) return lang === 'he' ? '0 דק\'' : '0m'
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  if (mins === 0) return lang === 'he' ? `${secs} שנ'` : `${secs}s`
  return lang === 'he' ? `${mins} דק'` : `${mins}m`
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

  if (lang === 'he') {
    if (diffMins < 1) return 'עכשיו'
    if (diffMins < 60) return `לפני ${diffMins} דק'`
    if (diffHours < 24) return `לפני ${diffHours} שעות`
    if (diffDays < 7) return `לפני ${diffDays} ימים`
    return formatDate(dateStr, 'he')
  }
  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return formatDate(dateStr, 'en')
}

export function scoreToEmoji(score: number): string {
  if (score >= 90) return '🌟'
  if (score >= 75) return '😊'
  if (score >= 55) return '😐'
  return '😟'
}

export function levelToEmoji(level: number): string {
  const emojis = ['🌱', '🚗', '⭐', '🛡️', '🏅', '💎', '🌟', '🏆', '⚡', '👑']
  return emojis[Math.min(level - 1, emojis.length - 1)]
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
