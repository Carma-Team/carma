import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '@/context/AppContext';
import { useTranslation } from '@/hooks/useTranslation';
import { formatDistance, formatDuration } from '@/lib/utils';
import { COLORS, COMMON_STYLES } from '@/constants/theme';
import { TripScoreHero } from '@/components/driving/TripScoreHero';
import { TripEventsList } from '@/components/driving/TripEventsList';
import { StatsGrid } from '@/components/ui/StatsGrid';
import { TripDetailHeader } from '@/components/driving/TripDetailHeader';
import { TripMapPlaceholder } from '@/components/driving/TripMapPlaceholder';

/**
 * מסך פירוט נסיעה בודדת.
 * מקבל tripId כ-param בניתוב ומחפש את הנסיעה ברשימת recentTrips שב-AppContext.
 * אין קריאה לשרת — הנתונים כבר נטענו בעת הכניסה לאפליקציה.
 */
export default function TripDetailScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { recentTrips } = useApp();
  const { t, lang } = useTranslation();

  const [trip, setTrip] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  /**
   * מחפש את הנסיעה לפי tripId בתוך recentTrips (state מקומי, ללא שרת).
   * recentTrips נטענות בעת ההתחברות מ-tripsApi.list() ומתעדכנות עם כל נסיעה חדשה.
   *
   * [שרת] אין קריאה לשרת בשלב זה. אם הנסיעה לא נמצאת ב-recentTrips
   * (למשל נסיעה ישנה יותר מ-10 האחרונות) — תוצג הודעת שגיאה.
   */
  useEffect(() => {
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

  const score = trip.avgScore ?? trip.score ?? 0;

  const events = [
    { label: t('trip.hardBrakes'),      emoji: '🛑', value: trip.hardBrakes ?? 0,      bad: (trip.hardBrakes ?? 0) > 0 },
    { label: t('trip.aggressiveAccels'),emoji: '🚀', value: trip.aggressiveAccels ?? 0, bad: (trip.aggressiveAccels ?? 0) > 0 },
    { label: t('trip.sharpTurns'),      emoji: '↩️', value: trip.sharpTurns ?? 0,       bad: (trip.sharpTurns ?? 0) > 0 },
    { label: t('trip.phoneTouches'),    emoji: '📱', value: trip.phoneSeconds ?? 0,      bad: (trip.phoneSeconds ?? 0) > 0 },
  ];

  return (
    <View style={[COMMON_STYLES.screen, { paddingTop: Math.max(insets.top, 20) }]}>
      <ScrollView style={styles.root} contentContainerStyle={COMMON_STYLES.scrollContent}>

        <TripDetailHeader />

        {/* Score hero */}
        <TripScoreHero
          score={score}
          date={trip.startTime}
          lang={lang}
        />

        {/* Stats Grid */}
        <StatsGrid items={[
          { emoji: '⏱️', label: t('trip.duration'), value: formatDuration(trip.durationSeconds ?? 0, lang) },
          { emoji: '📍', label: t('trip.distance'), value: formatDistance(trip.distanceKm ?? 0, lang) },
          { emoji: '⭐', label: t('common.points'), value: `+${Math.round(trip.points || 0)}` },
        ]} />

        {/* Events breakdown */}
        <TripEventsList events={events} />

        {/* Map Placeholder */}
        <TripMapPlaceholder />

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root:         { flex: 1, backgroundColor: COLORS.dark },
  center:       { justifyContent: 'center', alignItems: 'center' },
  back:         { marginBottom: 12 },
  backText:     { color: COLORS.brandLight, fontSize: 15, fontWeight: '600' },
});
