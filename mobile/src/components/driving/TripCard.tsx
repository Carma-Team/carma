import React from 'react'
import { TouchableOpacity, View, Text, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { formatDate, formatDistance, scoreToGrade, scoreToColor } from '@/lib/utils'
import { useTranslation } from '@/hooks/useTranslation'
import { COLORS } from '@/constants/theme'
import { ICONS } from '@/constants/icons'
import { syncStateOf } from '@/lib/tripSummary'
import type { Trip } from '@/types'

interface TripCardProps {
  trip: Trip
  onPress?: () => void
}

export function TripCard({ trip, onPress }: TripCardProps) {
  const { t, lang } = useTranslation()
  const displayScore = trip.avgScore
  // A row we created ourselves carries zeros until the server scores it, so a grade
  // badge on one reads as a real zero. Until there is a score to show, the card shows
  // where the trip got to instead — the same distinction the detail screen makes, from
  // the same function, so the two cannot drift apart.
  const syncState = syncStateOf(trip)
  const grade = scoreToGrade(displayScore)
  const badgeVariant = { excellent: 'success', good: 'success', fair: 'warning', poor: 'danger' }[grade] as any

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8} accessibilityRole="button">
      <Card>
        <View style={styles.row}>
          <Ionicons
            name={syncState ? ICONS.notSent : ICONS.noTrips}
            size={20}
            color={syncState === 'failed' ? COLORS.danger : syncState ? COLORS.textMuted : scoreToColor(displayScore)}
          />
          <View style={styles.info}>
            <Text style={styles.title} numberOfLines={1}>
              {formatDate(trip.startTime, lang)}
            </Text>
            <Text style={styles.sub}>
              {formatDistance(trip.distanceKm, lang)}
              {syncState
                ? ` · ${t(syncState === 'failed' ? 'trip.syncFailedDetail' : 'trip.syncPendingDetail')}`
                : ` · ${displayScore} ${t('dashboard.yourScore')}`}
            </Text>
          </View>
          <View style={styles.right}>
            {syncState ? (
              <Badge variant={syncState === 'failed' ? 'danger' : 'default'}>
                {t(syncState === 'failed' ? 'trip.syncFailed' : 'trip.syncPending')}
              </Badge>
            ) : (
              <>
                <Badge variant={badgeVariant}>{Math.round(displayScore)}</Badge>
                {!!trip.points && <Text style={styles.points}>+{Math.round(trip.points)} {t('common.points')}</Text>}
              </>
            )}
          </View>
        </View>
      </Card>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  row:       { flexDirection: 'row', alignItems: 'center', gap: 12 },
  info:      { flex: 1 },
  title:     { color: COLORS.text, fontWeight: '600', fontSize: 14 },
  sub:       { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  right:     { alignItems: 'flex-end', gap: 4 },
  points:    { color: COLORS.brandLight, fontSize: 12, fontWeight: '600' },
})

export default TripCard
