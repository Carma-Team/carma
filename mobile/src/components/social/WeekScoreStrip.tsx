import React, { useMemo } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { Card } from '@/components/ui/Card'
import { COLORS, TYPOGRAPHY, SPACING } from '@/constants/theme'
import { scoreToColor } from '@/lib/utils'
import he from '@/i18n/he'
import en from '@/i18n/en'
import type { Trip, Language } from '@/types'

interface WeekScoreStripProps {
  trips: Trip[]
  lang: Language
}

const DAY_SIZE = 38
const TODAY_SIZE = 42

/** Local calendar day, not UTC — a trip at 01:00 belongs to the day the driver had. */
function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

/** The seven dates of the week the given day falls in, Sunday first. */
function weekOf(today: Date): Date[] {
  const sunday = new Date(today)
  sunday.setDate(today.getDate() - today.getDay())
  sunday.setHours(0, 0, 0, 0)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(sunday)
    d.setDate(sunday.getDate() + i)
    return d
  })
}

export function WeekScoreStrip({ trips, lang }: WeekScoreStripProps) {
  const text = (lang === 'HE' ? he : en).stats.chart
  const today = new Date()
  const todayKey = dayKey(today)

  // Average per day, matching how the old trend chart bucketed: mean of that day's
  // trip scores, not a distance- or duration-weighted one.
  const scoreByDay = useMemo(() => {
    const map = new Map<string, number[]>()
    for (const trip of trips) {
      const date = new Date(trip.startTime)
      if (isNaN(date.getTime())) continue
      const key = dayKey(date)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(trip.avgScore ?? 0)
    }
    return new Map(
      Array.from(map.entries()).map(([key, scores]) => [
        key,
        Math.round(scores.reduce((s, v) => s + v, 0) / scores.length),
      ]),
    )
  }, [trips])

  const week = weekOf(today)
  const dayScores = week.map(d => scoreByDay.get(dayKey(d)) ?? null)
  const driven = dayScores.filter((s): s is number => s !== null)
  // Mean of the day averages, so the header agrees with the circles below it rather
  // than with a separate per-trip mean that would read as a different number.
  const weekAvg = driven.length
    ? Math.round(driven.reduce((s, v) => s + v, 0) / driven.length)
    : null

  return (
    <Card style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{text.thisWeek}</Text>
        <Text style={styles.avg}>
          {text.weekAvg} {weekAvg ?? '—'}
        </Text>
      </View>

      <View style={styles.row}>
        {week.map((date, i) => {
          const score = dayScores[i]
          const isToday = dayKey(date) === todayKey
          const size = isToday ? TODAY_SIZE : DAY_SIZE
          const color = score !== null ? scoreToColor(score) : COLORS.border
          // Swap this for `${date.getDate()}/${date.getMonth() + 1}` to label the
          // circles by date instead of by weekday.
          const label = text.days[date.getDay()]

          return (
            <View
              key={date.toISOString()}
              style={styles.dayCol}
              accessibilityLabel={`${label} — ${score !== null ? score : text.noDrive}`}
            >
              <View
                style={[
                  styles.circle,
                  {
                    width: size,
                    height: size,
                    borderRadius: size / 2,
                    borderWidth: isToday ? 3 : 2,
                    borderColor: color,
                    borderStyle: score === null ? 'dashed' : 'solid',
                    backgroundColor: score !== null ? color + (isToday ? '33' : '1F') : 'transparent',
                  },
                ]}
              >
                {score !== null && (
                  <Text style={[styles.score, { color }]}>{score}</Text>
                )}
              </View>
              <Text style={[styles.dayLabel, isToday && styles.dayLabelToday]}>{label}</Text>
            </View>
          )
        })}
      </View>
    </Card>
  )
}

const styles = StyleSheet.create({
  container: { padding: SPACING.md, marginBottom: SPACING.lg },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 12,
  },
  title: { ...TYPOGRAPHY.h3, fontSize: 14 },
  avg: { ...TYPOGRAPHY.caption, fontSize: 11 },

  row: { flexDirection: 'row', justifyContent: 'space-between' },
  dayCol: { alignItems: 'center' },
  circle: { alignItems: 'center', justifyContent: 'center' },
  score: { fontSize: 13, fontWeight: '800' },
  dayLabel: { ...TYPOGRAPHY.caption, fontSize: 10, marginTop: 4 },
  dayLabelToday: { color: COLORS.text, fontWeight: '800' },
})
