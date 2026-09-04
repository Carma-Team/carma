import React, { useMemo } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Card } from '@/components/ui/Card'
import { COLORS, TYPOGRAPHY, SPACING } from '@/constants/theme'
import { ICONS } from '@/constants/icons'
import { scoreToColor } from '@/lib/utils'
import { weeklyScoreTrend } from '@/lib/weeklyTrend'
import he from '@/i18n/he'
import en from '@/i18n/en'
import type { Trip, Language } from '@/types'

interface WeekScoreStripProps {
  trips: Trip[]
  lang: Language
}

const DAY_SIZE = 38
const TODAY_SIZE = 42

export function WeekScoreStrip({ trips, lang }: WeekScoreStripProps) {
  const text = (lang === 'HE' ? he : en).stats.chart

  // Recomputed only when the trip list changes: the window ends on today, and a
  // re-render inside the same day would not move it.
  const { days, dayScores, thisWeek, delta } = useMemo(() => weeklyScoreTrend(trips), [trips])
  // The window ends on today, so today is always the last circle.
  const todayIndex = days.length - 1

  const direction = delta === null || delta === 0 ? 'flat' : delta > 0 ? 'up' : 'down'
  const deltaColor =
    direction === 'up' ? COLORS.success : direction === 'down' ? COLORS.danger : COLORS.textMuted

  return (
    <Card style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{text.thisWeek}</Text>
        <View style={styles.avgBox}>
          <Text style={styles.avg}>
            {text.weekAvg} {thisWeek ?? '—'}
          </Text>
          {/* Only with both windows measured: an arrow against a week that was never
              driven would read as a drop the driver did not have. */}
          {delta !== null && (
            <View style={styles.deltaBox} accessibilityLabel={`${text.vsLastWeek} ${delta}`}>
              <Ionicons
                name={direction === 'up' ? ICONS.trendUp : direction === 'down' ? ICONS.trendDown : ICONS.trendFlat}
                size={14}
                color={deltaColor}
              />
              <Text style={[styles.delta, { color: deltaColor }]}>{Math.abs(delta)}</Text>
            </View>
          )}
        </View>
      </View>

      <View style={styles.row}>
        {days.map((date, i) => {
          const score = dayScores[i]
          const isToday = i === todayIndex
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

      <Text style={styles.footnote}>{text.vsLastWeek}</Text>
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
  avgBox: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  avg: { ...TYPOGRAPHY.caption, fontSize: 11 },
  deltaBox: { flexDirection: 'row', alignItems: 'center', gap: 1 },
  delta: { fontSize: 12, fontWeight: '700' },

  row: { flexDirection: 'row', justifyContent: 'space-between' },
  dayCol: { alignItems: 'center' },
  circle: { alignItems: 'center', justifyContent: 'center' },
  score: { fontSize: 13, fontWeight: '800' },
  dayLabel: { ...TYPOGRAPHY.caption, fontSize: 10, marginTop: 4 },
  dayLabelToday: { color: COLORS.text, fontWeight: '800' },
  footnote: { color: COLORS.textMuted, fontSize: 11, marginTop: 10 },
})
