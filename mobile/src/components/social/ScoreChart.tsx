import React, { useMemo } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { Card } from '@/components/ui/Card'
import { COLORS, TYPOGRAPHY, SPACING } from '@/constants/theme'
import type { Trip, Language } from '@/types'

interface ScoreChartProps {
  trips: Trip[]
  lang: Language
}

const Y_MIN = 40
const Y_MAX = 100
const CHART_H = 150

// ─── granularity ────────────────────────────────────────────────────────────

type Granularity = 'daily' | 'weekly' | 'monthly'

function chooseGranularity(trips: Trip[]): Granularity {
  if (trips.length < 2) return 'daily'
  const dates = trips.map(t => new Date(t.startTime).getTime()).filter(Boolean)
  const rangeDays = (Math.max(...dates) - Math.min(...dates)) / 86_400_000
  if (rangeDays < 21)  return 'daily'
  if (rangeDays < 90)  return 'weekly'
  return 'monthly'
}

function bucketKey(date: Date, g: Granularity): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  if (g === 'daily')   return `${y}-${m}-${d}`
  if (g === 'monthly') return `${y}-${m}`
  // weekly — ISO week key: year + week-start date (Monday)
  const ms = date.getTime()
  const dow = (date.getDay() + 6) % 7           // Mon=0 … Sun=6
  const monday = new Date(ms - dow * 86_400_000)
  const my = monday.getFullYear()
  const mm = String(monday.getMonth() + 1).padStart(2, '0')
  const md = String(monday.getDate()).padStart(2, '0')
  return `${my}-${mm}-${md}`
}

function bucketLabel(key: string, g: Granularity): string {
  if (g === 'monthly') {
    const [, m] = key.split('-')
    const months = ['ינו','פבר','מרץ','אפר','מאי','יוני','יולי','אוג','ספט','אוק','נוב','דצמ']
    return months[parseInt(m, 10) - 1] ?? m
  }
  // daily or weekly — show day/month
  const [, m, d] = key.split('-')
  return `${parseInt(d, 10)}/${parseInt(m, 10)}`
}

interface Bucket {
  key: string
  label: string
  avg: number
  count: number
}

function groupIntoBuckets(trips: Trip[], g: Granularity): Bucket[] {
  const map = new Map<string, number[]>()
  for (const trip of trips) {
    const date = new Date(trip.startTime)
    if (isNaN(date.getTime())) continue
    const key = bucketKey(date, g)
    const score = trip.avgScore ?? trip.score ?? 0
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(score)
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, scores]) => ({
      key,
      label: bucketLabel(key, g),
      avg: Math.round(scores.reduce((s, v) => s + v, 0) / scores.length),
      count: scores.length,
    }))
}

// ─── visual helpers ──────────────────────────────────────────────────────────

function scoreToColor(score: number): string {
  if (score >= 85) return COLORS.success
  if (score >= 72) return COLORS.warning
  return COLORS.danger
}

function scoreToHeight(score: number): number {
  const pct = Math.max(0, Math.min(1, (score - Y_MIN) / (Y_MAX - Y_MIN)))
  return Math.round(pct * CHART_H)
}

// ─── phase summary (first third / middle / last third of buckets) ─────────────

function phaseAvgs(buckets: Bucket[]): { label: string; avg: number }[] {
  if (buckets.length < 2) return []
  const third = Math.ceil(buckets.length / 3)
  const segs = [
    buckets.slice(0, third),
    buckets.slice(third, third * 2),
    buckets.slice(third * 2),
  ].filter(s => s.length > 0)
  const labels = ['תחילה', 'אמצע', 'לאחרונה']
  return segs.map((seg, i) => ({
    label: labels[i],
    avg: Math.round(seg.reduce((s, b) => s + b.avg, 0) / seg.length),
  }))
}

function granularityLabel(g: Granularity): string {
  if (g === 'daily')   return 'לפי יום'
  if (g === 'weekly')  return 'לפי שבוע'
  return 'לפי חודש'
}

// ─── component ───────────────────────────────────────────────────────────────

export function ScoreChart({ trips, lang }: ScoreChartProps) {
  // API returns newest-first → sort oldest-first before processing
  const sorted = useMemo(
    () => [...trips].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()),
    [trips],
  )

  const granularity = useMemo(() => chooseGranularity(sorted), [sorted])
  const buckets     = useMemo(() => groupIntoBuckets(sorted, granularity), [sorted, granularity])
  const phases      = useMemo(() => phaseAvgs(buckets), [buckets])

  const first = phases[0]?.avg ?? 0
  const last  = phases[phases.length - 1]?.avg ?? 0
  const improvePct = first > 0 ? Math.round(((last - first) / first) * 100) : 0

  if (sorted.length === 0) {
    return (
      <Card style={styles.container}>
        <Text style={[TYPOGRAPHY.h3, styles.title]}>מגמת ציונים</Text>
        <Text style={[TYPOGRAPHY.body, styles.empty]}>אין נסיעות עדיין</Text>
      </Card>
    )
  }

  return (
    <Card style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={[TYPOGRAPHY.h3, styles.title]}>מגמת ציונים</Text>
        <Text style={styles.granularityTag}>{granularityLabel(granularity)}</Text>
      </View>

      {/* Phase summary */}
      {phases.length >= 2 && (
        <View style={styles.phaseRow}>
          {phases.map((phase, i) => (
            <React.Fragment key={phase.label}>
              <View style={styles.phaseCard}>
                <Text style={styles.phaseLabel}>{phase.label}</Text>
                <Text style={[styles.phaseAvg, { color: scoreToColor(phase.avg) }]}>
                  {phase.avg}
                </Text>
              </View>
              {i < phases.length - 1 && (
                <Text style={styles.arrow}>›</Text>
              )}
            </React.Fragment>
          ))}
        </View>
      )}

      {/* Bar chart */}
      <View style={styles.chartRow}>
        <View style={[styles.yAxis, { height: CHART_H }]}>
          {[Y_MAX, Math.round((Y_MAX + Y_MIN) / 2), Y_MIN].map(v => (
            <Text key={v} style={styles.yLabel}>{v}</Text>
          ))}
        </View>

        <View style={[styles.barsArea, { height: CHART_H }]}>
          {[0, 0.5, 1].map(pct => (
            <View key={pct} style={[styles.gridLine, { bottom: pct * CHART_H }]} />
          ))}
          {buckets.map(b => (
            <View key={b.key} style={styles.barCol}>
              <View
                style={[
                  styles.bar,
                  { height: scoreToHeight(b.avg), backgroundColor: scoreToColor(b.avg) },
                ]}
              />
              {buckets.length <= 16 && (
                <Text style={styles.xLabel} numberOfLines={1}>{b.label}</Text>
              )}
            </View>
          ))}
        </View>
      </View>

      {/* Improvement badge */}
      {improvePct > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>
            📈 שיפור של +{improvePct}% מאז תחילת הנסיעות
          </Text>
        </View>
      )}
    </Card>
  )
}

// ─── styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:  { padding: SPACING.md },
  headerRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  title:      { marginBottom: 0 },
  granularityTag: {
    ...TYPOGRAPHY.caption,
    fontSize: 11,
    color: COLORS.brandLight,
    backgroundColor: 'rgba(129,140,248,0.12)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  empty: { textAlign: 'center', color: COLORS.textMuted, marginVertical: 20 },

  phaseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
    gap: 6,
  },
  phaseCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  phaseLabel: { ...TYPOGRAPHY.caption, fontSize: 11, color: COLORS.textMuted },
  phaseAvg:   { fontSize: 26, fontWeight: '800' as const, lineHeight: 32 },
  arrow:      { color: COLORS.textMuted, fontSize: 22, marginTop: -4 },

  chartRow:  { flexDirection: 'row', alignItems: 'flex-end' },
  yAxis:     { width: 26, justifyContent: 'space-between', paddingRight: 4 },
  yLabel:    { fontSize: 10, color: COLORS.textMuted },

  barsArea: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    borderLeftWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 4,
    position: 'relative',
  },
  gridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  barCol:  { flex: 1, alignItems: 'center', height: '100%', justifyContent: 'flex-end' },
  bar:     { width: '80%', borderRadius: 3, opacity: 0.85 },
  xLabel:  { fontSize: 8, color: COLORS.textMuted, marginTop: 4, width: '100%', textAlign: 'center' },

  badge: {
    marginTop: 14,
    backgroundColor: 'rgba(34,197,94,0.1)',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  badgeText: { ...TYPOGRAPHY.caption, color: COLORS.success, fontSize: 12 },
})
