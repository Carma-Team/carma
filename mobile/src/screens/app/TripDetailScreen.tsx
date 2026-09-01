import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity, Animated,
  Easing,
} from 'react-native';
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

// How far the outgoing trip travels before it is replaced. Small on purpose: the
// summary carries a native map view, and a long slide across one is what stutters.
const SHIFT = 24;
// Out is quicker than in — the eye forgives a fast exit, but an entrance at the same
// speed reads as a flicker rather than a move. Both are well under the ~250ms where a
// transition stops feeling like a response to the tap and starts feeling like a wait.
const OUT_MS = 90;
const IN_MS = 140;

export default function TripDetailScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { recentTrips } = useApp();
  const { t } = useTranslation();

  // The route param only says which trip to open. Stepping between trips after that
  // is state, not navigation: re-entering the route unmounted the screen, which threw
  // away the fetched detail and flashed the spinner on every step.
  const [currentId, setCurrentId] = useState(tripId);

  // The param is the opening trip, not the current one — but it still wins whenever
  // it changes. Reading it only at mount would leave the previous trip on screen if
  // the route is ever re-entered onto this instance rather than a fresh one.
  useEffect(() => {
    if (tripId) setCurrentId(tripId);
  }, [tripId]);

  // The cached row paints immediately; the fetch is what carries the event timeline
  // and, for anything but a just-completed trip, the route as well.
  const [detail, setDetail] = useState<TripDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  // Details already fetched this visit, including the neighbours fetched ahead of a
  // tap. Without it every step would show the spinner again for a trip just seen.
  const cache = useRef(new Map<string, TripDetail>()).current;

  const shift = useRef(new Animated.Value(0)).current;
  const animating = useRef(false);

  // recentTrips is newest-first, so the later trip is the lower index.
  const idx = recentTrips.findIndex(x => x.id === currentId);

  const cached = useMemo(
    () => recentTrips.find(x => x.id === currentId) ?? null,
    [recentTrips, currentId],
  );

  useEffect(() => {
    if (!currentId) {
      setLoading(false);
      return;
    }
    let alive = true;

    const load = (id: string) =>
      tripsApi.getById(id).then(res => { cache.set(id, res.trip); return res.trip; });

    const hit = cache.get(currentId);
    if (hit) {
      setDetail(hit);
      setFailed(false);
      setLoading(false);
    } else {
      setDetail(null);
      setFailed(false);
      setLoading(true);
      // A trip out of the cache window — older than the ten kept, or after the history
      // was cleared — is still on the server. It used to render as a bare error here.
      load(currentId)
        .then(trip => { if (alive) setDetail(trip); })
        // A trip still waiting in the sync queue is not on the server at all, so a
        // failure here only means "no detail" — it is an error solely when the cache
        // has nothing to show either.
        .catch(() => { if (alive) setFailed(true); })
        .finally(() => { if (alive) setLoading(false); });
    }

    // Both neighbours, so the next tap in either direction lands on a trip whose
    // detail is already here. Failures are ignored: this is only ever an optimisation.
    [idx - 1, idx + 1].forEach(i => {
      const id = recentTrips[i]?.id;
      if (id && !cache.has(id)) load(id).catch(() => {});
    });

    return () => { alive = false; };
  }, [currentId, idx, recentTrips, cache]);

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

  /**
   * Steps to an adjacent trip. `dir` is +1 towards a newer trip, matching the header's
   * up arrow: the trip on screen leaves downwards and the newer one arrives from above,
   * so the movement agrees with the arrow that was pressed.
   */
  const step = (dir: 1 | -1) => {
    const target = recentTrips[idx - dir];
    // Guarded rather than trusted: a second tap mid-animation would otherwise skip a
    // trip and leave the screen offset, since the entrance never ran for the first.
    if (!target || animating.current) return;
    animating.current = true;

    Animated.timing(shift, {
      toValue: dir * SHIFT,
      duration: OUT_MS,
      // Accelerating out, decelerating in. The default easing eases both ends, which
      // at these durations spends most of the time barely moving and reads as sluggish
      // even though the clock says otherwise.
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(() => {
      setCurrentId(target.id);
      // Back to the top for the incoming trip — arriving halfway down a summary you
      // have not seen reads as a broken screen.
      scrollRef.current?.scrollTo({ y: 0, animated: false });
      shift.setValue(-dir * SHIFT);
      Animated.timing(shift, {
        toValue: 0,
        duration: IN_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start(() => { animating.current = false; });
    });
  };

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

  return (
    <View style={[COMMON_STYLES.screen, { paddingTop: Math.max(insets.top, 20) }]}>
      <Animated.View
        style={[
          styles.root,
          {
            transform: [{ translateY: shift }],
            opacity: shift.interpolate({
              inputRange: [-SHIFT, 0, SHIFT],
              outputRange: [0, 1, 0],
            }),
          },
        ]}
      >
        <ScrollView ref={scrollRef} style={styles.root} contentContainerStyle={COMMON_STYLES.scrollContent}>

          <TripDetailHeader
            date={trip.startTime}
            hasNewer={idx > 0}
            hasOlder={idx >= 0 && idx < recentTrips.length - 1}
            onNewer={() => step(1)}
            onOlder={() => step(-1)}
          />

          <TripSummaryView summary={summary} loadingRoute={loading} />

          {failed && (
            <Text style={styles.partial}>{t('trip.detailUnavailable')}</Text>
          )}

        </ScrollView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: COLORS.dark },
  center:  { justifyContent: 'center', alignItems: 'center' },
  // Says the timeline is missing rather than letting an empty map imply a clean trip.
  partial: { color: COLORS.textMuted, textAlign: 'center', marginTop: 16, fontSize: 12 },
});
