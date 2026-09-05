import React, { useCallback, useEffect, useState } from 'react';
import { View, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/Button';
import { DashboardHero } from '@/components/gamification/DashboardHero';
import { StatsGrid } from '@/components/ui/StatsGrid';
import { TripSummaryModal } from '@/components/driving/TripSummaryModal';
import { DashboardHeader } from '@/components/dashboard/DashboardHeader';
import { RecentTripsSection } from '@/components/dashboard/RecentTripsSection';
import { WeeklyTrendCard } from '@/components/dashboard/WeeklyTrendCard';
import { useApp } from '@/context/AppContext';
import { useTranslation } from '@/hooks/useTranslation';
import { COLORS, SPACING, COMMON_STYLES } from '@/constants/theme';
import { ICONS } from '@/constants/icons';
import { availableBalance, formatDistance } from '@/lib/utils';
import { badgeCount } from '@/lib/notifications';
import ActiveTripScreen from '@/screens/app/ActiveTripScreen';
import { userApi } from '@/services/api/user.api';
import { friendsApi } from '@/services/api/friends.api';
import { notificationsApi } from '@/services/api/notifications.api';

export default function DashboardScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, recentTrips, isLoading, tripState, startTrip, lastTripSummary, setLastTripSummary } = useApp();
  const { t, lang } = useTranslation();
  const [currentStreak, setCurrentStreak] = useState<number | null>(null);
  const [bestStreak, setBestStreak] = useState<number | null>(null);
  // Tri-state, and each state matters. null = the first stats response has not landed,
  // so the hero shows a placeholder rather than a score that for a new driver is the
  // fleet prior. false = a measured zero. true also covers a failed stats call: losing
  // the request must not hide the score of a driver who does have history.
  const [hasMeasuredHistory, setHasMeasuredHistory] = useState<boolean | null>(null);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [unreadNotifications, setUnreadNotifications] = useState(0);

  // On focus rather than on mount: both counts are cleared by the very screens the
  // badges lead to, and the dashboard is what the user comes back to straight after.
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      // Failures leave the count at whatever it was. A badge is an aid, not a fact the
      // screen depends on, and an error banner over the dashboard for one would be worse
      // than the badge being briefly stale.
      friendsApi.getIncoming()
        .then(d => { if (alive) setPendingRequests(d.requests.length); })
        .catch(() => {});
      notificationsApi.list()
        .then(rows => { if (alive) setUnreadNotifications(badgeCount(rows)); })
        .catch(() => {});
      return () => { alive = false; };
    }, []),
  );

  /**
   * [server] userApi.stats() → GET /api/user/stats, streak is a server rule (days-in-a-row).
   *
   * A failure leaves every piece of state exactly as it was, and that is the whole
   * decision (CAR-302). A returning driver keeps the score the last successful call
   * reported, so a flaky network does not hide a score they earned. A driver whose very
   * first call fails has no last answer to keep, so `hasMeasuredHistory` stays `null` and
   * the hero shows `--` — the placeholder, not the fleet prior the server sends to a
   * driver with no measured trips, coloured as if they had earned it. Setting it to
   * `true` on failure served the first driver at the second one's expense.
   */
  const loadStats = useCallback(() => {
    userApi.stats()
      .then(d => {
        setCurrentStreak(d.stats.currentStreak);
        setBestStreak(d.stats.bestStreak);
        setHasMeasuredHistory(d.stats.totalTrips > 0);
      })
      .catch(err => console.error('Stats error:', err));
  }, []);

  useEffect(loadStats, [loadStats]);

  // Re-fetch after a trip completes so a streak earned just now doesn't wait for app restart.
  // Guarded on lastTripSummary itself (not showSummary) — closing the modal resets it to null,
  // and without the guard that reset would fire this same request again.
  useEffect(() => {
    if (!lastTripSummary) return;
    loadStats();
  }, [lastTripSummary, loadStats]);

  // Controls whether the post-trip summary modal is visible
  const [showSummary, setShowSummary] = useState(false);

  useEffect(() => {
    if (lastTripSummary) {
      setShowSummary(true);
    }
  }, [lastTripSummary]);

  const handleCloseSummary = () => {
    setShowSummary(false);
    setLastTripSummary(null);
  };

  const handleViewDetails = (tripId: string) => {
    setShowSummary(false);
    setLastTripSummary(null);
    router.push({
      pathname: '/(home)/trip-detail',
      params: { tripId }
    });
  };

  if (!user || isLoading) {
    return (
      <View style={[COMMON_STYLES.screen, COMMON_STYLES.center]}>
        <ActivityIndicator size="large" color={COLORS.brand} />
      </View>
    );
  }

  // While a trip is active, show ActiveTripScreen in place of the dashboard
  if (tripState.isActive) {
    return <ActiveTripScreen />;
  }

  return (
    <View style={[COMMON_STYLES.screen, { paddingTop: Math.max(insets.top, 20) }]}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={COMMON_STYLES.scrollContent}>

        {/* Header Section */}
        <DashboardHeader
          userName={user.name || ''}
          currentStreak={currentStreak}
          bestStreak={bestStreak}
          pendingRequests={pendingRequests}
          unreadNotifications={unreadNotifications}
        />

        {/* Level & Points Card */}
        {/* The deployed profile can omit the score altogether (CAR-296), and a missing
            one rounds to NaN rather than to anything a null check would catch. A score
            that cannot be rendered is not an earned one, so it takes the same
            placeholder as a driver with no measured history. */}
        <DashboardHero
          user={user}
          driverScore={Math.round(user.driverScore)}
          hasMeasuredHistory={Number.isFinite(user.driverScore) && (hasMeasuredHistory ?? false)}
          lang={lang}
        />

        {/* Week-over-week trend — above the grid, which is all-time totals */}
        <WeeklyTrendCard trips={recentTrips} />

        {/* Quick Summary Grid */}
        <StatsGrid
          columns={3}
          variant="compact"
          items={[
            { icon: ICONS.trips,    value: recentTrips.length,                          label: t('stats.totalTrips') },
            { icon: ICONS.distance, value: formatDistance(user.totalDistance || 0, lang), label: t('stats.totalDistance') },
            // The spendable balance, not the lifetime total — the level progress
            // above already carries the total, and this is the number a driver
            // walks into the store with.
            { icon: ICONS.points,   value: availableBalance(user).toLocaleString(),      label: t('marketplace.availablePoints') },
          ]}
        />

        {/* Start Trip Action */}
        <Button
          fullWidth
          size="xl"
          onPress={startTrip}
          style={styles.ctaBtn}
        >
          {t('dashboard.startTrip')}
        </Button>

        {/* Recent History List */}
        <RecentTripsSection trips={recentTrips} />

      </ScrollView>

      {/* Post-trip summary modal */}
      <TripSummaryModal
        visible={showSummary}
        summary={lastTripSummary}
        onClose={handleCloseSummary}
        onViewDetails={handleViewDetails}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  ctaBtn: { marginVertical: SPACING.lg },
});
