import React from 'react'
import { TouchableOpacity, View, Text, StyleSheet } from 'react-native'
import { Ionicons, FontAwesome5 } from '@expo/vector-icons'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { formatDate, formatDistance } from '@/lib/utils'
import { scoreToGrade, scoreToColor } from '@/lib/scoring'
import { useTranslation } from '@/hooks/useTranslation'
import { COLORS } from '@/constants/theme'
import { ICONS } from '@/constants/icons'
import type { Trip } from '@/types'

interface TripCardProps {
  trip: Trip
  onPress?: () => void
}

export function TripCard({ trip, onPress }: TripCardProps) {
  const { t, lang } = useTranslation()
  const displayScore = trip.avgScore ?? trip.score ?? 0
  const grade = scoreToGrade(displayScore)
  const badgeVariant = { excellent: 'success', good: 'success', fair: 'warning', poor: 'danger' }[grade] as any

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8}>
      <Card>
        <View style={styles.row}>
          <FontAwesome5 name="map-marked-alt" size={20} color={scoreToColor(displayScore)} />
          <View style={styles.info}>
            <Text style={styles.title} numberOfLines={1}>
              {formatDate(trip.startTime, lang)}
            </Text>
            <Text style={styles.sub}>
              {formatDistance(trip.distanceKm, lang)} · {displayScore} {t('dashboard.yourScore')}
            </Text>
          </View>
          <View style={styles.right}>
            <Badge variant={badgeVariant}>{Math.round(displayScore)}</Badge>
            {!!trip.points && <Text style={styles.points}>+{Math.round(trip.points)} {t('common.points')}</Text>}
          </View>
        </View>

        {(trip.eventsArray?.length ?? 0) > 0 && (
          <View style={styles.events}>
            <Ionicons name={ICONS.flash} size={13} color={COLORS.textMuted} />
            <Text style={styles.eventText}>{trip.eventsArray!.length} {t('trip.events')}</Text>
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
  title:     { color: COLORS.text, fontWeight: '600', fontSize: 14 },
  sub:       { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  right:     { alignItems: 'flex-end', gap: 4 },
  points:    { color: COLORS.brandLight, fontSize: 12, fontWeight: '600' },
  events:    { flexDirection: 'row', gap: 12, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: COLORS.border },
  eventText: { color: COLORS.textMuted, fontSize: 12 },
  riskText:  { color: COLORS.warning, fontSize: 12 },
})

export default TripCard
