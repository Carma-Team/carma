import React from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { formatDuration, formatDistance } from '@/lib/utils'
import { useTranslation } from '@/hooks/useTranslation'
import type { TripState } from '@/hooks/useTrip'
import { COLORS } from '@/lib/constants'

interface ActiveTripMonitorProps {
  state: TripState
  onEnd: () => void
  loading?: boolean
}

function getLight(state: TripState): 'green' | 'yellow' | 'red' {
  const { eventCounts } = state
  const total = (eventCounts.HARD_BRAKE || 0) * 5 +
                (eventCounts.AGGRESSIVE_ACCEL || 0) * 3 +
                (eventCounts.SHARP_TURN || 0) * 2 +
                (eventCounts.PHONE_TOUCH || 0) * 10

  if (total === 0)  return 'green'
  if (total <= 5)   return 'yellow'
  return 'red'
}

const LIGHT_CONFIG = {
  green:  { color: '#22c55e', emoji: '😊' },
  yellow: { color: '#f59e0b', emoji: '😐' },
  red:    { color: '#ef4444', emoji: '😟' },
}

export function ActiveTripMonitor({ state, onEnd, loading }: ActiveTripMonitorProps) {
  const { t, lang } = useTranslation()
  const light  = getLight(state)
  const config = LIGHT_CONFIG[light]

  const events = [
    { key: 'HARD_BRAKE',       label: t('trip.hardBrakes'),       emoji: '⚡', count: state.eventCounts.HARD_BRAKE },
    { key: 'AGGRESSIVE_ACCEL', label: t('trip.aggressiveAccels'), emoji: '🚀', count: state.eventCounts.AGGRESSIVE_ACCEL },
    { key: 'SHARP_TURN',       label: t('trip.sharpTurns'),       emoji: '↩️', count: state.eventCounts.SHARP_TURN },
    { key: 'PHONE_TOUCH',      label: t('trip.phoneTouches'),     emoji: '📱', count: state.eventCounts.PHONE_TOUCH },
  ]

  return (
    <View style={styles.container}>
      {/* Traffic light */}
      <Card glass style={styles.lightCard}>
        <View style={[styles.circle, { backgroundColor: config.color, shadowColor: config.color }]}>
          <Text style={styles.circleEmoji}>{config.emoji}</Text>
        </View>
        <Text style={styles.lightLabel}>{t(`trip.trafficLight.${light}`)}</Text>
      </Card>

      {/* Stats */}
      <View style={styles.statsRow}>
        <Card glass style={styles.statCard}>
          <Text style={styles.statValue}>{formatDuration(state.durationSeconds, lang)}</Text>
          <Text style={styles.statLabel}>{t('trip.duration')}</Text>
        </Card>
        <Card glass style={styles.statCard}>
          <Text style={styles.statValue}>{formatDistance(state.distanceKm, lang)}</Text>
          <Text style={styles.statLabel}>{t('trip.distance')}</Text>
        </Card>
      </View>

      {/* Event counters */}
      <Card glass padding="sm">
        <View style={styles.eventsGrid}>
          {events.map(ev => (
            <View key={ev.key} style={styles.eventCell}>
              <Text style={styles.eventLabel}>{ev.emoji} {ev.label}</Text>
              <Text style={[styles.eventCount, { color: ev.count > 0 ? '#ef4444' : '#22c55e' }]}>{ev.count}</Text>
            </View>
          ))}
        </View>
      </Card>

      {/* Speed (Debug/Info) */}
      <Text style={styles.speedText}>מהירות נוכחית: {Math.round(state.currentSpeedKmH)} קמ"ש</Text>

      {/* End Trip Button */}
      <Button
        variant="outline"
        onPress={onEnd}
        loading={loading}
        style={styles.endBtn}
      >
        🏁 סיום נסיעה
      </Button>
    </View>
  )
}

const styles = StyleSheet.create({
  container:  { gap: 12 },
  lightCard:  { alignItems: 'center', paddingVertical: 24 },
  circle:     { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center', shadowOpacity: 0.5, shadowRadius: 20, elevation: 8, marginBottom: 12 },
  circleEmoji:{ fontSize: 36 },
  lightLabel: { color: '#fff', fontSize: 18, fontWeight: '700' },
  statsRow:   { flexDirection: 'row', gap: 12 },
  statCard:   { flex: 1, alignItems: 'center', paddingVertical: 12 },
  statValue:  { color: '#fff', fontSize: 22, fontWeight: '700' },
  statLabel:  { color: '#94a3b8', fontSize: 12, marginTop: 4 },
  eventsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  eventCell:  { width: '45%', flexGrow: 1, flexDirection: 'row', justifyContent: 'space-between', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  eventLabel: { color: '#cbd5e1', fontSize: 12 },
  eventCount: { fontSize: 13, fontWeight: '700' },
  speedText:  { color: COLORS.textMuted, textAlign: 'center', fontSize: 12, marginTop: 8 },
  endBtn:     { marginTop: 12, borderColor: '#ef4444' }
})

export default ActiveTripMonitor
