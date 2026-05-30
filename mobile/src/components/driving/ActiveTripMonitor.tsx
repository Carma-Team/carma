import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { COLORS, TYPOGRAPHY, SPACING } from '@/constants/theme';
import { formatDuration, formatDistance } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';

interface ActiveTripMonitorProps {
  tripState: {
    durationSeconds: number;
    distanceKm: number;
    eventCounts: {
      HARD_BRAKE: number;
      AGGRESSIVE_ACCEL: number;
      SHARP_TURN: number;
      PHONE_TOUCH: number;
    };
  };
  onEnd: () => void;
  showDebug?: boolean;
  onDebugAddDistance?: (km: number) => void;
}

export function ActiveTripMonitor({ tripState, onEnd, showDebug, onDebugAddDistance }: ActiveTripMonitorProps) {
  const { t } = useTranslation();

  const events = [
    { label: t('trip.hardBrakes'), value: tripState.eventCounts.HARD_BRAKE, emoji: '🛑', color: COLORS.warning },
    { label: t('trip.aggressiveAccels'), value: tripState.eventCounts.AGGRESSIVE_ACCEL, emoji: '🚀', color: COLORS.warning },
    { label: t('trip.sharpTurns'), value: tripState.eventCounts.SHARP_TURN, emoji: '↩️', color: COLORS.warning },
    { label: t('trip.phoneTouches'), value: tripState.eventCounts.PHONE_TOUCH, emoji: '📱', color: COLORS.danger },
  ];

  return (
    <View style={styles.container}>
      {/* Timer & Distance */}
      <View style={styles.statsContainer}>
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>{t('trip.duration')}</Text>
          <Text style={styles.statValue}>{formatDuration(tripState.durationSeconds)}</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>{t('trip.distance')}</Text>
          <Text style={styles.statValue}>{formatDistance(tripState.distanceKm)}</Text>
        </View>
      </View>

      {/* Real-time Events Grid */}
      <Text style={styles.sectionTitle}>{t('trip.eventsDetected')}</Text>
      <View style={styles.grid}>
        {events.map(event => (
          <Card key={event.label} style={styles.eventCard}>
            <Text style={styles.eventEmoji}>{event.emoji}</Text>
            <Text style={[styles.eventValue, { color: event.value > 0 ? event.color : '#fff' }]}>
              {event.value}
            </Text>
            <Text style={styles.eventLabel}>{event.label}</Text>
          </Card>
        ))}
      </View>

      {/* Main Action - End Trip */}
      <Button
        variant="danger"
        fullWidth
        size="xl"
        onPress={onEnd}
        style={styles.inlineEndBtn}
      >
        🛑 {t('trip.endBtn')}
      </Button>

      {/* Admin Debug Tools */}
      {showDebug && onDebugAddDistance && (
        <View style={styles.debugContainer}>
          <Text style={styles.debugTitle}>🛠️ כלי ניהול (מצב דמו)</Text>
          <View style={styles.debugRow}>
            <Button
              variant="secondary"
              size="sm"
              onPress={() => onDebugAddDistance(10)}
              style={styles.debugBtn}
            >
              {'+10 ק"מ'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onPress={() => onDebugAddDistance(0.1)}
              style={styles.debugBtn}
            >
              +100 מטר
            </Button>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 30,
    backgroundColor: COLORS.card,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: COLORS.border
  },
  statBox: { alignItems: 'center', flex: 1 },
  statLabel: { ...TYPOGRAPHY.caption, color: COLORS.textMuted, marginBottom: 5 },
  statValue: { color: '#fff', fontSize: 32, fontWeight: '900' },
  sectionTitle: { ...TYPOGRAPHY.label, color: COLORS.textMuted, marginBottom: 15, marginStart: 5 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', marginBottom: 25 },
  eventCard: { width: '48%', alignItems: 'center', paddingVertical: 20 },
  eventEmoji: { fontSize: 24, marginBottom: 8 },
  eventValue: { fontSize: 28, fontWeight: '900', marginBottom: 4 },
  eventLabel: { ...TYPOGRAPHY.caption, fontSize: 12 },
  inlineEndBtn: { borderRadius: 20, height: 65, marginBottom: 15 },
  debugContainer: {
    marginBottom: 20,
    padding: 15,
    borderWidth: 1,
    borderColor: COLORS.warning,
    borderRadius: 16,
    borderStyle: 'dashed',
    backgroundColor: 'rgba(255, 153, 0, 0.05)',
  },
  debugTitle: {
    ...TYPOGRAPHY.caption,
    color: COLORS.warning,
    marginBottom: 12,
    fontWeight: 'bold',
    textAlign: 'center'
  },
  debugRow: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'center'
  },
  debugBtn: {
    flex: 1,
    maxWidth: 140
  }
});

export default ActiveTripMonitor;
