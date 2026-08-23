import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '@/context/AppContext';
import { useTranslation } from '@/hooks/useTranslation';
import { COLORS, COMMON_STYLES } from '@/constants/theme';
import { TripDetailHeader } from '@/components/driving/TripDetailHeader';
import { TripSummaryView } from '@/components/driving/TripSummaryView';
import { tripsApi } from '@/services/api/trips.api';
import { toDrivingEvents } from '@/lib/tripEvents';
import { fromServerTrip } from '@/lib/tripSummary';
import type { TripDetail } from '@/types';

export default function TripDetailScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { recentTrips } = useApp();
  const { t } = useTranslation();

  // The cached row paints immediately; the fetch is what carries the event timeline
  // and, for anything but a just-completed trip, the route as well.
  const [detail, setDetail] = useState<TripDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const cached = useMemo(
    () => recentTrips.find(x => x.id === tripId) ?? null,
    [recentTrips, tripId],
  );

  // Keyed on the id alone. `recentTrips` gets a new identity whenever a trip syncs
  // or the list reloads, and refetching on that would blank the route and flash the
  // spinner over a screen that is already showing the trip.
  useEffect(() => {
    if (!tripId) {
      setLoading(false);
      return;
    }
    // The header steps between trips in place, so a slow response can land after the
    // screen has already moved on to another one.
    let current = true;
    setDetail(null);
    setFailed(false);
    setLoading(true);
    // A trip out of the cache window — older than the ten kept, or after the history
    // was cleared — is still on the server. It used to render as a bare error here.
    tripsApi.getById(tripId)
      .then(res => { if (current) setDetail(res.trip); })
      // A trip still waiting in the sync queue is not on the server at all, so a
      // failure here only means "no detail" — it is an error solely when the cache
      // has nothing to show either.
      .catch(() => { if (current) setFailed(true); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [tripId]);

  const trip = detail ?? cached;

  const summary = useMemo(() => {
    if (!trip) return null;
    return fromServerTrip(
      trip,
      // Whichever actually has a route: the server omits waypoints for a trip it
      // stored without them, and that must not erase the track still in the cache
      // from the drive that just ended.
      detail?.routeWaypoints?.length ? detail.routeWaypoints : cached?.routeWaypoints ?? [],
      toDrivingEvents(detail?.events),
    );
  }, [trip, detail, cached]);

  useEffect(() => {
    if (summary?.id) {
      // Nudge the scroll indicator so the map below the fold doesn't read as the end
      // of the screen on first render.
      scrollRef.current?.flashScrollIndicators();
    }
  }, [summary?.id]);

  if (!trip || !summary) {
    return (
      <View style={[styles.root, styles.center]}>
        {loading ? (
          <ActivityIndicator color={COLORS.brand} size="large" />
        ) : (
          <>
            <Text style={{ color: COLORS.textMuted }}>{t('common.error')}</Text>
            <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 20 }}>
              <Text style={{ color: COLORS.brand }}>{t('common.back')}</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    );
  }

  // recentTrips is newest-first, so the later trip is the lower index.
  const idx = recentTrips.findIndex(x => x.id === tripId);
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

        <TripSummaryView summary={summary} loadingRoute={loading} />

        {failed && (
          <Text style={styles.partial}>{t('trip.detailUnavailable')}</Text>
        )}

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: COLORS.dark },
  center:  { justifyContent: 'center', alignItems: 'center' },
  // Says the timeline is missing rather than letting an empty map imply a clean trip.
  partial: { color: COLORS.textMuted, textAlign: 'center', marginTop: 16, fontSize: 12 },
});
