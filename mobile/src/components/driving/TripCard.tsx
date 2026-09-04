import React from 'react'
import { TouchableOpacity, View, Text, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { formatDate, formatDistance, scoreToGrade, scoreToColor } from '@/lib/utils'
import { useTranslation } from '@/hooks/useTranslation'
import { COLORS } from '@/constants/theme'
import { ICONS } from '@/constants/icons'
import type { Trip } from '@/types'

interface TripCardProps {
  trip: Trip
  onPress?: () => void
  /** Selection mode: shows a checkbox and makes a press toggle it instead of opening. */
  selectable?: boolean
  selected?: boolean
}

export function TripCard({ trip, onPress, selectable, selected }: TripCardProps) {
  const { t, lang } = useTranslation()
  const displayScore = trip.avgScore ?? trip.score ?? 0
  // A row we created ourselves carries zeros until the server scores it, so a grade
  // badge on one reads as a real zero — the same distinction `tripSummary.ts` makes.
  // Until there is a score to show, the card shows where the trip got to instead.
  // `syncFailed` wins over `pendingSync`: a row that was given up on may still carry
  // the flag it was queued with, and "given up" is the state that matters.
  const syncState = trip.syncFailed ? 'failed' : trip.pendingSync ? 'pending' : null
  const grade = scoreToGrade(displayScore)
  const badgeVariant = { excellent: 'success', good: 'success', fair: 'warning', poor: 'danger' }[grade] as any

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole={selectable ? 'checkbox' : 'button'}
      accessibilityState={selectable ? { checked: !!selected } : undefined}
    >
      <Card style={selected ? styles.selected : undefined}>
        <View style={styles.row}>
          {selectable ? (
            <Ionicons
              name={selected ? 'checkbox' : 'square-outline'}
              size={22}
              color={selected ? COLORS.brand : COLORS.textMuted}
            />
          ) : (
            <Ionicons
              name={syncState ? ICONS.notSent : ICONS.noTrips}
              size={20}
              color={syncState === 'failed' ? COLORS.danger : syncState ? COLORS.textMuted : scoreToColor(displayScore)}
            />
          )}
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
  info:      { flex: 1 },
  title:     { color: COLORS.text, fontWeight: '600', fontSize: 14 },
  sub:       { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  right:     { alignItems: 'flex-end', gap: 4 },
  points:    { color: COLORS.brandLight, fontSize: 12, fontWeight: '600' },
  events:    { flexDirection: 'row', gap: 12, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: COLORS.border },
  eventText: { color: COLORS.textMuted, fontSize: 12 },
  riskText:  { color: COLORS.warning, fontSize: 12 },
  selected:  { borderColor: COLORS.brand, borderWidth: 1 },
})

export default TripCard
