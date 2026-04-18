import React, { useEffect, useState } from 'react'
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native'
import { Card }    from '@/components/ui/Card'
import { Badge }   from '@/components/ui/Badge'
import { useTranslation } from '@/hooks/useTranslation'
import { tripsApi } from '@/lib/api'
import { scoreToGrade, scoreToColor } from '@/lib/scoring'
import { formatDate, formatDistance, formatDuration, scoreToEmoji } from '@/lib/utils'
import { COLORS } from '@/lib/constants'
import type { Trip } from '@/navigation/types'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import type { RouteProp } from '@react-navigation/native'
import type { RootStackParamList } from '@/navigation/types'

interface Props {
  navigation: NativeStackNavigationProp<RootStackParamList, 'TripDetail'>
  route:      RouteProp<RootStackParamList, 'TripDetail'>
}

export default function TripDetailScreen({ navigation, route }: Props) {
  const { tripId } = route.params
  const { t, lang } = useTranslation()
  const [trip,    setTrip]    = useState<Trip | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    tripsApi.get(tripId)
      .then(data => setTrip(data.trip))
      .finally(() => setLoading(false))
  }, [tripId])

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={COLORS.brand} size="large" />
      </View>
    )
  }

  if (!trip) {
    return (
      <View style={styles.center}>
        <Text style={{ color: COLORS.textMuted }}>{t('common.error')}</Text>
      </View>
    )
  }

  const grade        = scoreToGrade(trip.score)
  const color        = scoreToColor(trip.score)
  const badgeVariant = { excellent: 'success', good: 'success', fair: 'warning', poor: 'danger' }[grade] as any

  const events = [
    { label: t('trip.hardBrakes'),       emoji: '⚡', value: trip.hardBrakes,       penalty: 5, bad: trip.hardBrakes > 0 },
    { label: t('trip.aggressiveAccels'), emoji: '🚀', value: trip.aggressiveAccels,  penalty: 3, bad: trip.aggressiveAccels > 0 },
    { label: t('trip.sharpTurns'),       emoji: '↩️', value: trip.sharpTurns,        penalty: 2, bad: trip.sharpTurns > 0 },
    { label: t('trip.phoneTouches'),     emoji: '📱', value: trip.phoneSeconds,      penalty: 0, bad: trip.phoneSeconds > 10, suffix: 's' },
  ]

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
        <Text style={styles.backText}>← {t('common.back')}</Text>
      </TouchableOpacity>

      {/* Score hero */}
      <Card glass glow style={styles.hero}>
        <Text style={styles.heroEmoji}>{scoreToEmoji(trip.score)}</Text>
        <Text style={[styles.heroScore, { color }]}>{Math.round(trip.score)}</Text>
        <Badge variant={badgeVariant}>{t(`trip.status.${grade}`)}</Badge>
        <Text style={styles.heroDate}>{formatDate(trip.startTime, lang)}</Text>
      </Card>

      {/* Stats */}
      <View style={styles.statsRow}>
        {[
          { emoji: '⏱️', label: t('trip.duration'), value: formatDuration(trip.durationSeconds, lang) },
          { emoji: '📍', label: t('trip.distance'), value: formatDistance(trip.distanceKm, lang) },
          { emoji: '⭐', label: t('common.points'), value: `+${Math.round(trip.points)}` },
        ].map(s => (
          <Card key={s.label} padding="sm" style={styles.statCard}>
            <Text style={styles.statEmoji}>{s.emoji}</Text>
            <Text style={styles.statValue}>{s.value}</Text>
            <Text style={styles.statLabel}>{s.label}</Text>
          </Card>
        ))}
      </View>

      {/* Risk multiplier */}
      {trip.riskMultiplier > 1 && (
        <Card glass padding="sm" style={styles.riskCard}>
          <Text style={styles.riskText}>
            🌙 {t('trip.riskHourBonus')} ×{trip.riskMultiplier}
          </Text>
        </Card>
      )}

      {/* Events breakdown */}
      <Text style={styles.sectionTitle}>{t('trip.events')}</Text>
      <Card>
        {events.map((ev, i) => (
          <View key={ev.label} style={[styles.eventRow, i < events.length - 1 && styles.eventDivider]}>
            <Text style={styles.eventEmoji}>{ev.emoji}</Text>
            <Text style={styles.eventLabel}>{ev.label}</Text>
            <Text style={[styles.eventValue, { color: ev.bad ? '#ef4444' : '#22c55e' }]}>
              {ev.value}{ev.suffix ?? ''}
            </Text>
          </View>
        ))}
      </Card>

      {/* AI Insight */}
      {trip.aiInsight && (
        <>
          <Text style={styles.sectionTitle}>{t('trip.aiInsight')}</Text>
          <Card glass>
            <Text style={styles.insightText}>💡 {trip.aiInsight}</Text>
          </Card>
        </>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  root:         { flex: 1, backgroundColor: COLORS.dark },
  content:      { padding: 16, paddingBottom: 100 },
  center:       { flex: 1, backgroundColor: COLORS.dark, alignItems: 'center', justifyContent: 'center' },
  back:         { marginBottom: 12 },
  backText:     { color: COLORS.brandLight, fontSize: 15, fontWeight: '600' },
  hero:         { alignItems: 'center', gap: 8, paddingVertical: 32, marginBottom: 12 },
  heroEmoji:    { fontSize: 52 },
  heroScore:    { fontSize: 64, fontWeight: '900' },
  heroDate:     { color: COLORS.textMuted, fontSize: 13 },
  statsRow:     { flexDirection: 'row', gap: 10, marginBottom: 12 },
  statCard:     { flex: 1, alignItems: 'center' },
  statEmoji:    { fontSize: 20, marginBottom: 4 },
  statValue:    { color: '#fff', fontWeight: '700', fontSize: 15 },
  statLabel:    { color: COLORS.textMuted, fontSize: 11, marginTop: 2 },
  riskCard:     { marginBottom: 12 },
  riskText:     { color: '#f59e0b', fontSize: 14, fontWeight: '600', textAlign: 'center' },
  sectionTitle: { color: '#fff', fontWeight: '700', fontSize: 16, marginBottom: 8, marginTop: 16 },
  eventRow:     { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 10 },
  eventDivider: { borderBottomWidth: 1, borderBottomColor: COLORS.border },
  eventEmoji:   { fontSize: 20, width: 28 },
  eventLabel:   { flex: 1, color: '#cbd5e1', fontSize: 14 },
  eventValue:   { fontSize: 15, fontWeight: '700' },
  insightText:  { color: '#e2e8f0', fontSize: 14, lineHeight: 22 },
})
