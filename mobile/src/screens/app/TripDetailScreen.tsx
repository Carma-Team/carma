import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '@/context/AppContext';
import { useTranslation } from '@/hooks/useTranslation';
import { formatTripDistance, formatTripDuration } from '@/lib/utils';
import { COLORS, COMMON_STYLES, SPACING } from '@/constants/theme';
import { ICONS } from '@/constants/icons';
import { TripScoreGauge } from '@/components/driving/TripScoreGauge';
import { StatsGrid } from '@/components/ui/StatsGrid';
import { TripDetailHeader } from '@/components/driving/TripDetailHeader';
import { TripMapPlaceholder } from '@/components/driving/TripMapPlaceholder';
import { tripsApi } from '@/services/api/trips.api';
import { toDrivingEvents } from '@/lib/tripEvents';
import type { DrivingEvent } from '@/lib/driving-sdk/types';

export default function TripDetailScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { recentTrips } = useApp();
  const { t } = useTranslation();

  const [trip, setTrip] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [routeWaypoints, setRouteWaypoints] = useState<any[]>([]);
  const [tripEvents, setTripEvents] = useState<DrivingEvent[]>([]);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (!loading && trip) {
      // Nudge the scroll indicator so the events section below the fold
      // doesn't read as the end of the screen on first render.
      scrollRef.current?.flashScrollIndicators();
    }
  }, [loading, trip]);

  useEffect(() => {
    const foundTrip = recentTrips.find(t => t.id === tripId);
    if (foundTrip) {
      setTrip(foundTrip);
      // Paint the map immediately when the cached trip already carries waypoints
      // (just-completed trip), so the route doesn't wait on the network.
      if (foundTrip.routeWaypoints?.length) {
        setRouteWaypoints(foundTrip.routeWaypoints);
      }
      // Fetch regardless: the event timeline is returned only by the single-trip
      // endpoint, so cached waypoints are not a reason to skip the request.
      if (tripId) {
        tripsApi.getById(tripId)
          .then(res => {
            if (res.trip.routeWaypoints?.length) setRouteWaypoints(res.trip.routeWaypoints);
            setTripEvents(toDrivingEvents(res.trip.events));
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

  // recentTrips is newest-first, so the later trip is the lower index.
  const idx = recentTrips.findIndex(t => t.id === tripId);
  // replace, not push: stepping through trips must not stack up a back history.
  const goTo = (target: number) =>
    router.replace({ pathname: '/(home)/trip-detail', params: { tripId: recentTrips[target].id } });

  return (
    <View style={[COMMON_STYLES.screen, { paddingTop: Math.max(insets.top, 20) }]}>
      <ScrollView ref={scrollRef} style={styles.root} contentContainerStyle={COMMON_STYLES.scrollContent}>

        <TripDetailHeader
          date={trip.startTime}
          hasNewer={idx > 0}
          hasOlder={idx >= 0 && idx < recentTrips.length - 1}
          onNewer={() => goTo(idx - 1)}
          onOlder={() => goTo(idx + 1)}
        />

        {/* Score gauge */}
        {/* Deliberately not a Card: the gauge sits straight on the screen background.
            Its own wrapper style is where a background or border would go if the
            screen ever needs one here. */}
        <View style={styles.gaugeBlock}>
          <TripScoreGauge score={score} />
        </View>

        {/* Stats Grid */}
        {/* `compact` rather than shrinking COMMON_STYLES.statCard, which the home
            screen shares: it already gives four equal-width, shorter boxes with one
            font size and one colour across all of them. */}
        <StatsGrid columns={4} variant="compact" items={[
          { icon: ICONS.duration, label: t('trip.duration'), value: formatTripDuration(trip.durationSeconds ?? 0) },
          { icon: ICONS.distance, label: t('trip.distance'), value: formatTripDistance(trip.distanceKm ?? 0) },
          { icon: ICONS.points,   label: t('common.points'), value: `+${Math.round(trip.points || 0)}` },
          { icon: ICONS.flash,    label: t('trip.riskMultiplier'), value: `x${(trip.effectiveRiskMultiplier ?? 1).toFixed(2)}` },
        ]} />

        {/* Route map */}
        <TripMapPlaceholder
          waypoints={routeWaypoints}
          events={tripEvents}
        />

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root:      { flex: 1, backgroundColor: COLORS.dark },
  center:    { justifyContent: 'center', alignItems: 'center' },
  // Wrapper around the gauge, and the only thing deciding where it sits.
  // `paddingTop` is what pulls the gauge up toward the header — raise it to push
  // the gauge down the screen. `marginBottom` is the gap to the stats row below.
  // A background or border for the gauge area would go here too (see the JSX).
  gaugeBlock: { alignItems: 'center', paddingTop: 0, paddingBottom: 4, marginBottom: SPACING.sm },
});
