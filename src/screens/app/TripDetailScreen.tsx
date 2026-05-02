import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useApp } from '@/context/AppContext';
import { useTranslation } from '@/hooks/useTranslation';
import { scoreToGrade, scoreToColor } from '@/lib/scoring';
import { formatDate, formatDistance, formatDuration, scoreToEmoji } from '@/lib/utils';
import { COLORS, COMMON_STYLES, SPACING, TYPOGRAPHY } from '@/theme';
import type { Trip } from '@/navigation/types';

export default function TripDetailScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { recentTrips } = useApp();
  const { t, lang } = useTranslation();

  const [trip, setTrip] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // חיפוש הנסיעה ברשימת הנסיעות האחרונות
    const foundTrip = recentTrips.find(t => t.id === tripId);
    if (foundTrip) {
      setTrip(foundTrip);
    }
    setLoading(false);
  }, [tripId, recentTrips]);

  if (loading) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={COLORS.brand} size="large" />
      </View>
    );
  }

  if (!trip) {
    return (
      <View style={[styles.root, styles.center]}>
        <Text style={{ color: COLORS.textMuted }}>{t('common.error') || 'הנסיעה לא נמצאה'}</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 20 }}>
          <Text style={{ color: COLORS.brand }}>חזור</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const score = trip.score ?? trip.avg_score ?? 0;
  const grade = scoreToGrade(score);
  const color = scoreToColor(score);
  const badgeVariant = { excellent: 'success', good: 'success', fair: 'warning', poor: 'danger' }[grade] as any;

  // מיפוי אירועים גמיש - תומך במבנה ה-SDK ובמבנה ה-DB העתידי
  const events = [
    { label: t('trip.hardBrakes'), emoji: '🛑', value: trip.hardBrakes ?? trip.eventCounts?.HARD_BRAKE ?? 0, bad: (trip.hardBrakes || trip.eventCounts?.HARD_BRAKE) > 0 },
    { label: t('trip.aggressiveAccels'), emoji: '🚀', value: trip.aggressiveAccels ?? trip.eventCounts?.AGGRESSIVE_ACCEL ?? 0, bad: (trip.aggressiveAccels || trip.eventCounts?.AGGRESSIVE_ACCEL) > 0 },
    { label: t('trip.sharpTurns'), emoji: '↩️', value: trip.sharpTurns ?? trip.eventCounts?.SHARP_TURN ?? 0, bad: (trip.sharpTurns || trip.eventCounts?.SHARP_TURN) > 0 },
    { label: t('trip.phoneTouches'), emoji: '📱', value: trip.phoneSeconds ?? trip.phoneSeconds ?? 0, bad: (trip.phoneSeconds || trip.phoneSeconds) > 0 },
  ];

  return (
    <View style={[COMMON_STYLES.screen, { paddingTop: Math.max(insets.top, 20) }]}>
      <ScrollView style={styles.root} contentContainerStyle={COMMON_STYLES.scrollContent}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back}>
          <Text style={styles.backText}>← {t('common.back')}</Text>
        </TouchableOpacity>

        {/* Score hero */}
        <Card glass glow style={styles.hero}>
          <Text style={styles.heroEmoji}>{scoreToEmoji(score)}</Text>
          <Text style={[styles.heroScore, { color }]}>{Math.round(score)}</Text>
          <Badge variant={badgeVariant}>{t(`trip.status.${grade}`)}</Badge>
          <Text style={styles.heroDate}>{formatDate(trip.date || trip.startTime || trip.start_time, lang)}</Text>
        </Card>

        {/* Stats Grid */}
        <View style={styles.statsRow}>
          {[
            { emoji: '⏱️', label: t('trip.duration'), value: formatDuration(trip.duration || trip.durationSeconds || 0, lang) },
            { emoji: '📍', label: t('trip.distance'), value: formatDistance(trip.distance || trip.distanceKm || 0, lang) },
            { emoji: '⭐', label: t('common.points'), value: `+${Math.round(trip.points || 0)}` },
          ].map(s => (
            <Card key={s.label} padding="sm" style={styles.statCard}>
              <Text style={styles.statEmoji}>{s.emoji}</Text>
              <Text style={styles.statValue}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </Card>
          ))}
        </View>

        {/* Events breakdown */}
        <Text style={styles.sectionTitle}>{t('trip.events')}</Text>
        <Card>
          {events.map((ev, i) => (
            <View key={ev.label} style={[styles.eventRow, i < events.length - 1 && styles.eventDivider]}>
              <Text style={styles.eventEmoji}>{ev.emoji}</Text>
              <Text style={styles.eventLabel}>{ev.label}</Text>
              <Text style={[styles.eventValue, { color: ev.bad ? COLORS.danger : COLORS.success }]}>
                {ev.value}
              </Text>
            </View>
          ))}
        </Card>

        {/* Placeholder for Map / Route Details */}
        <Card glass style={{ marginTop: 20, paddingVertical: 40, alignItems: 'center', borderStyle: 'dashed', borderWidth: 1, borderColor: COLORS.border }}>
          <Text style={{ fontSize: 30 }}>🗺️</Text>
          <Text style={{ color: COLORS.textMuted, marginTop: 10 }}>תצוגת מפה תתווסף בקרוב</Text>
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root:         { flex: 1, backgroundColor: COLORS.dark },
  center:       { justifyContent: 'center', alignItems: 'center' },
  back:         { marginBottom: 12 },
  backText:     { color: COLORS.brandLight, fontSize: 15, fontWeight: '600' },
  hero:         { alignItems: 'center', gap: 8, paddingVertical: 32, marginBottom: SPACING.md },
  heroEmoji:    { fontSize: 52 },
  heroScore:    { fontSize: 64, fontWeight: '900' },
  heroDate:     { ...TYPOGRAPHY.caption },
  statsRow:     { flexDirection: 'row', gap: 10, marginBottom: SPACING.md },
  statCard:     { flex: 1, alignItems: 'center' },
  statEmoji:    { fontSize: 20, marginBottom: 4 },
  statValue:    { color: '#fff', fontWeight: '700', fontSize: 15 },
  statLabel:    { ...TYPOGRAPHY.caption, fontSize: 11, marginTop: 2 },
  sectionTitle: { ...TYPOGRAPHY.h3, marginBottom: 8, marginTop: 16 },
  eventRow:     { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 10 },
  eventDivider: { borderBottomWidth: 1, borderBottomColor: COLORS.border },
  eventEmoji:   { fontSize: 20, width: 28 },
  eventLabel:   { flex: 1, color: COLORS.textMuted, fontSize: 14 },
  eventValue:   { fontSize: 15, fontWeight: '700' },
});
