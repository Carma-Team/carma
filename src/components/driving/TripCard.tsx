import React from 'react'
import { TouchableOpacity, View, Text, StyleSheet } from 'react-native'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { formatDate, formatDistance, formatDuration, scoreToEmoji } from '@/lib/utils'
import { scoreToGrade } from '@/lib/scoring'
import { useTranslation } from '@/hooks/useTranslation'
import type { Trip } from '@/navigation/types'

interface TripCardProps {
  trip: Trip
  onPress?: () => void
}

export function TripCard({ trip, onPress }: TripCardProps) {
  const { t, lang } = useTranslation()
  const grade = scoreToGrade(trip.score)
  const badgeVariant = { excellent: 'success', good: 'success', fair: 'warning', poor: 'danger' }[grade] as any

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8}>
      <Card>
        <View style={styles.row}>
          <Text style={styles.emoji}>{scoreToEmoji(trip.score)}</Text>
          <View style={styles.info}>
            <Text style={styles.title} numberOfLines={1}>
              {trip.startLocation && trip.endLocation
                ? `${trip.startLocation} → ${trip.endLocation}`
                : formatDate(trip.startTime, lang)}
            </Text>
            <Text style={styles.sub}>
              {formatDate(trip.startTime, lang)} · {formatDuration(trip.durationSeconds, lang)} · {formatDistance(trip.distanceKm, lang)}
            </Text>
          </View>
          <View style={styles.right}>
            <Badge variant={badgeVariant}>{Math.round(trip.score)}</Badge>
            <Text style={styles.points}>+{Math.round(trip.points)} {t('common.points')}</Text>
          </View>
        </View>

        {(trip.hardBrakes > 0 || trip.phoneSeconds > 10) && (
          <View style={styles.events}>
            {trip.hardBrakes > 0 && <Text style={styles.eventText}>⚡ {trip.hardBrakes} {t('trip.hardBrakes')}</Text>}
            {trip.phoneSeconds > 10 && <Text style={styles.eventText}>📱 {trip.phoneSeconds}s</Text>}
            {trip.riskMultiplier > 1 && <Text style={styles.riskText}>🌙 x{trip.riskMultiplier}</Text>}
          </View>
        )}
      </Card>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  row:       { flexDirection: 'row', alignItems: 'center', gap: 12 },
  emoji:     { fontSize: 24 },
  info:      { flex: 1 },
  title:     { color: '#fff', fontWeight: '600', fontSize: 14 },
  sub:       { color: '#94a3b8', fontSize: 12, marginTop: 2 },
  right:     { alignItems: 'flex-end', gap: 4 },
  points:    { color: '#818cf8', fontSize: 12, fontWeight: '600' },
  events:    { flexDirection: 'row', gap: 12, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#1f2937' },
  eventText: { color: '#94a3b8', fontSize: 12 },
  riskText:  { color: '#f59e0b', fontSize: 12 },
})

export default TripCard
