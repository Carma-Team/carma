import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '@/context/AppContext';
import { useTranslation } from '@/hooks/useTranslation';
import { formatDistance, formatDuration } from '@/lib/utils';
import { COLORS, COMMON_STYLES } from '@/constants/theme';
import { ICONS } from '@/constants/icons';
import { TripScoreHero } from '@/components/driving/TripScoreHero';
import { TripEventsList } from '@/components/driving/TripEventsList';
import { StatsGrid } from '@/components/ui/StatsGrid';
import { TripDetailHeader } from '@/components/driving/TripDetailHeader';
import { TripMapPlaceholder } from '@/components/driving/TripMapPlaceholder';
import { tripsApi } from '@/services/api/trips.api';
import type { DrivingEvent } from '@/lib/driving-sdk/types';

export default function TripDetailScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { recentTrips } = useApp();
  const { t, lang } = useTranslation();

  const [trip, setTrip] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [routeWaypoints, setRouteWaypoints] = useState<any[]>([]);
  const [tripEvents, setTripEvents] = useState<DrivingEvent[]>([]);

  useEffect(() => {
    const foundTrip = recentTrips.find(t => t.id === tripId);
    if (foundTrip) {
      setTrip(foundTrip);
      // If the cached trip already has waypoints (just-completed trip), use them directly.
      // Otherwise fetch from the single-trip endpoint which includes route_waypoints.
      if (foundTrip.routeWaypoints?.length) {
        setRouteWaypoints(foundTrip.routeWaypoints);
      } else if (tripId) {
        tripsApi.getById(tripId)
          .then(res => {
            if (res.trip.routeWaypoints) setRouteWaypoints(res.trip.routeWaypoints);
          })
          .catch(() => {});
      }
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
        <Text style={{ color: COLORS.textMuted }}>{t('common.error')}</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 20 }}>
          <Text style={{ color: COLORS.brand }}>{t('common.back')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const score = trip.avgScore ?? trip.score ?? 0;

  const events = [
    { label: t('trip.hardBrakes'),       icon: ICONS.hardBrake,       value: trip.hardBrakes ?? 0,      bad: (trip.hardBrakes ?? 0) > 0 },
    { label: t('trip.aggressiveAccels'), icon: ICONS.aggressiveAccel, value: trip.aggressiveAccels ?? 0, bad: (trip.aggressiveAccels ?? 0) > 0 },
    { label: t('trip.sharpTurns'),   icon: ICONS.sharpTurn,  value: trip.sharpTurns ?? 0,  bad: (trip.sharpTurns ?? 0) > 0 },
    // { label: t('trip.swerve'), icon: ICONS.swerve, value: trip.swerves ?? 0, bad: (trip.swerves ?? 0) > 0 }, // EVT_SWERVE disabled
    { label: t('trip.phoneTouches'), icon: ICONS.phoneUsage, value: trip.touchEpochs ?? 0, bad: (trip.touchEpochs ?? 0) > 0 },
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
        <StatsGrid columns={3} items={[
          { icon: ICONS.duration, label: t('trip.duration'), value: formatDuration(trip.durationSeconds ?? 0, lang) },
          { icon: ICONS.distance, label: t('trip.distance'), value: formatDistance(trip.distanceKm ?? 0, lang) },
          { icon: ICONS.points,   label: t('common.points'), value: `+${Math.round(trip.points || 0)}` },
        ]} />

        {/* Events breakdown */}
        <TripEventsList events={events} />

        {/* Route map */}
        <TripMapPlaceholder
          waypoints={routeWaypoints}
          events={trip.tripEvents ?? tripEvents}
        />

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: COLORS.dark },
  center: { justifyContent: 'center', alignItems: 'center' },
});
