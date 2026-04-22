import React from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useApp } from '@/context/AppContext';
import { useTranslation } from '@/hooks/useTranslation';
import { COLORS, TYPOGRAPHY, SPACING, COMMON_STYLES } from '@/lib/constants';
import { formatDuration, formatDistance } from '@/lib/utils';

/**
 * מסך נסיעה פעילה.
 * מוצג אוטומטית על ידי ה-Dashboard כאשר tripState.isActive הוא true.
 */
export default function ActiveTripScreen() {
  const insets = useSafeAreaInsets();
  const { tripState, endTrip } = useApp();
  const { t } = useTranslation();

  const handleEndTrip = async () => {
    // הצגת שאלת אישור לפני סיום הנסיעה
    Alert.alert(
      t('trip.endTripConfirm'),
      t('trip.endTripMessage'),
      [
        {
          text: t('common.cancel'),
          style: 'cancel'
        },
        {
          text: t('trip.endBtn'),
          style: 'destructive',
          onPress: async () => {
            // קריאה לסיום נסיעה - ה-Dashboard יטפל בהצגת הסיכום
            await endTrip();
          }
        }
      ]
    );
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('trip.activeTrip')}</Text>
        <View style={styles.liveIndicator}>
          <View style={styles.dot} />
          <Text style={styles.liveText}>LIVE</Text>
        </View>
      </View>

      <View style={styles.mainContent}>
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
          {[
            { label: t('trip.hardBrakes'), value: tripState.eventCounts.HARD_BRAKE, emoji: '🛑', color: COLORS.warning },
            { label: t('trip.aggressiveAccels'), value: tripState.eventCounts.AGGRESSIVE_ACCEL, emoji: '🚀', color: COLORS.warning },
            { label: t('trip.sharpTurns'), value: tripState.eventCounts.SHARP_TURN, emoji: '↩️', color: COLORS.warning },
            { label: t('trip.phoneTouches'), value: tripState.eventCounts.PHONE_TOUCH, emoji: '📱', color: COLORS.danger },
          ].map(event => (
            <Card key={event.label} style={styles.eventCard}>
              <Text style={styles.eventEmoji}>{event.emoji}</Text>
              <Text style={[styles.eventValue, { color: event.value > 0 ? event.color : '#fff' }]}>
                {event.value}
              </Text>
              <Text style={styles.eventLabel}>{event.label}</Text>
            </Card>
          ))}
        </View>

        <Card glass style={styles.infoCard}>
          <Text style={styles.infoText}>
            💡 {t('trip.safetyTip')}
          </Text>
        </Card>
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 20 }]}>
        <Button
          variant="danger"
          fullWidth
          size="xl"
          onPress={handleEndTrip}
          style={styles.endBtn}
        >
          🛑 {t('trip.endBtn')}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.dark },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: SPACING.lg,
    marginTop: 10
  },
  title: { ...TYPOGRAPHY.h2, color: '#fff' },
  liveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)'
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.danger, marginEnd: 6 },
  liveText: { color: COLORS.danger, fontSize: 12, fontWeight: '900' },
  mainContent: { flex: 1, paddingHorizontal: SPACING.lg },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 30,
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
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between' },
  eventCard: { width: '48%', alignItems: 'center', paddingVertical: 20 },
  eventEmoji: { fontSize: 24, marginBottom: 8 },
  eventValue: { fontSize: 28, fontWeight: '900', marginBottom: 4 },
  eventLabel: { ...TYPOGRAPHY.caption, fontSize: 12 },
  infoCard: { marginTop: 30, padding: 15, backgroundColor: 'rgba(59, 130, 246, 0.05)' },
  infoText: { color: COLORS.brandLight, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  footer: { paddingHorizontal: SPACING.lg },
  endBtn: { borderRadius: 20, height: 65 }
});
