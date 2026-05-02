import React from 'react';
import { View, Text, StyleSheet, Alert, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useApp } from '@/context/AppContext';
import { useTranslation } from '@/hooks/useTranslation';
import { COLORS, TYPOGRAPHY, SPACING, COMMON_STYLES } from '@/theme';
import { formatDuration, formatDistance } from '@/lib/utils';

/**
 * מסך נסיעה פעילה.
 * מוצג אוטומטית על ידי ה-Dashboard כאשר tripState.isActive הוא true.
 */
export default function ActiveTripScreen() {
  const insets = useSafeAreaInsets();
  const { tripState, endTrip, user, debugAddDistance } = useApp();
  const { t } = useTranslation();

  // הצגת כלי ניהול אם המשתמש אדמין או שהשם שלו מכיל "מנהל" (לצורך הדמו)
  const showDebug = user?.role === 'admin' || user?.name?.includes('מנהל');

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

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
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

        {/* Main Action - End Trip (Now part of the scroll flow) */}
        <Button
          variant="danger"
          fullWidth
          size="xl"
          onPress={handleEndTrip}
          style={styles.inlineEndBtn}
        >
          🛑 {t('trip.endBtn')}
        </Button>

        {/* Admin Debug Tools - Moved to the very bottom */}
        {showDebug && (
          <View style={styles.debugContainer}>
            <Text style={styles.debugTitle}>🛠️ כלי ניהול (מצב דמו)</Text>
            <View style={styles.debugRow}>
              <Button
                variant="secondary"
                size="sm"
                onPress={() => debugAddDistance(10)}
                style={styles.debugBtn}
              >
                +10 ק"מ
              </Button>
              <Button
                variant="outline"
                size="sm"
                onPress={() => debugAddDistance(0.1)}
                style={styles.debugBtn}
              >
                +100 מטר
              </Button>
            </View>
          </View>
        )}
      </ScrollView>
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
  scrollView: { flex: 1 },
  scrollContent: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: 60,
    flexGrow: 1
  },
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
