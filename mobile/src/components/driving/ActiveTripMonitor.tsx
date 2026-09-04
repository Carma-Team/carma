import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { COLORS, TYPOGRAPHY } from '@/constants/theme';
import { ICONS } from '@/constants/icons';
import { formatDuration, formatDistance } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';

interface ActiveTripMonitorProps {
  tripState: {
    durationSeconds: number;
    distanceKm: number;
    touchEpochs: number;
    eventCounts: {
      HARD_BRAKE: number;
      AGGRESSIVE_ACCEL: number;
      SHARP_TURN: number;
    };
  };
  onEnd: () => void;
  showDebug?: boolean;
  onDebugAddDistance?: (km: number) => void;
}

export function ActiveTripMonitor({ tripState, onEnd, showDebug, onDebugAddDistance }: ActiveTripMonitorProps) {
  const { t } = useTranslation();

  const events = [
    { label: t('trip.hardBrakes'),       value: tripState.eventCounts.HARD_BRAKE,       icon: ICONS.hardBrake,       color: COLORS.warning },
    { label: t('trip.aggressiveAccels'), value: tripState.eventCounts.AGGRESSIVE_ACCEL, icon: ICONS.aggressiveAccel, color: COLORS.warning },
    { label: t('trip.sharpTurns'),       value: tripState.eventCounts.SHARP_TURN,       icon: ICONS.sharpTurn,       color: COLORS.warning },
    { label: t('trip.phoneTouches'),     value: tripState.touchEpochs,                  icon: ICONS.phoneUsage,      color: COLORS.danger },
  ];

  return (
    <View style={styles.container}>
      {/* Main Action - End Trip. Top of the screen: it is the only thing a driver
          needs to reach here, and reaching it must not depend on scrolling. */}
      <Button
        variant="danger"
        fullWidth
        size="xl"
        onPress={onEnd}
        style={styles.inlineEndBtn}
      >
        {t('trip.endBtn')}
      </Button>

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

      {/* Live event counts — a debugging aid, not something a driver is shown.
          Gated on the same flag as the debug tools below. */}
      {showDebug && (
        <>
          <Text style={styles.sectionTitle}>{t('trip.eventsDetected')}</Text>
          <View style={styles.grid}>
            {events.map(event => (
              <Card key={event.label} style={styles.eventCard}>
                <Ionicons
                  name={event.icon}
                  size={24}
                  color={event.value > 0 ? event.color : COLORS.textMuted}
                  style={{ marginBottom: 8 }}
                />
                <Text style={[styles.eventValue, { color: event.value > 0 ? event.color : COLORS.text }]}>
                  {event.value}
                </Text>
                <Text style={styles.eventLabel}>{event.label}</Text>
              </Card>
            ))}
          </View>
        </>
      )}

      {/* Admin Debug Tools */}
      {showDebug && onDebugAddDistance && (
        <View style={styles.debugContainer}>
          <Text style={styles.debugTitle}>{t('driving.debugTitle')}</Text>
          <View style={styles.debugRow}>
            <Button
              variant="outline"
              size="sm"
              onPress={() => onDebugAddDistance(0.1)}
              style={styles.debugBtn}
            >
              {t('driving.addDistanceSmall')}
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
  statBox:      { alignItems: 'center', flex: 1 },
  statLabel:    { ...TYPOGRAPHY.caption, color: COLORS.textMuted, marginBottom: 5 },
  statValue:    { color: COLORS.text, fontSize: 32, fontWeight: '900' },
  sectionTitle: { ...TYPOGRAPHY.label, color: COLORS.textMuted, marginBottom: 15, marginStart: 5 },
  grid:         { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', marginBottom: 25 },
  eventCard:    { width: '48%', alignItems: 'center', paddingVertical: 20 },
  eventValue:   { fontSize: 28, fontWeight: '900', marginBottom: 4 },
  eventLabel:   { ...TYPOGRAPHY.caption, fontSize: 12 },
  inlineEndBtn: { borderRadius: 20, height: 65, marginBottom: 25 },
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
  debugRow: { flexDirection: 'row', gap: 10, justifyContent: 'center' },
  debugBtn: { flex: 1, maxWidth: 140 },
});

export default ActiveTripMonitor;
