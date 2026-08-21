import React, { useEffect, useState } from 'react';
import { View, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/Button';
import { DashboardHero } from '@/components/gamification/DashboardHero';
import { StatsGrid } from '@/components/ui/StatsGrid';
import { TripSummaryModal } from '@/components/driving/TripSummaryModal';
import { DashboardHeader } from '@/components/dashboard/DashboardHeader';
import { RecentTripsSection } from '@/components/dashboard/RecentTripsSection';
import { useApp } from '@/context/AppContext';
import { useTranslation } from '@/hooks/useTranslation';
import { COLORS, SPACING, COMMON_STYLES } from '@/constants/theme';
import { ICONS } from '@/constants/icons';
import { formatDistance } from '@/lib/utils';
import ActiveTripScreen from '@/screens/app/ActiveTripScreen';
import { userApi } from '@/services/api/user.api';

export default function DashboardScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, recentTrips, isLoading, tripState, startTrip, lastTripSummary, setLastTripSummary } = useApp();
  const { t, lang } = useTranslation();
  const [avgScore, setAvgScore] = useState<number | null>(null);
  const [currentStreak, setCurrentStreak] = useState<number | null>(null);
  const [bestStreak, setBestStreak] = useState<number | null>(null);

  // [server] userApi.stats() → GET /api/user/stats, streak is a server rule (days-in-a-row).
  useEffect(() => {
    userApi.stats()
      .then(d => {
        setCurrentStreak(d.stats.currentStreak);
        setBestStreak(d.stats.bestStreak);
      })
      .catch(err => console.error('Stats error:', err));
  }, []);

  // Re-fetch after a trip completes so a streak earned just now doesn't wait for app restart.
  // Guarded on lastTripSummary itself (not showSummary) — closing the modal resets it to null,
  // and without the guard that reset would fire this same request again.
  useEffect(() => {
    if (!lastTripSummary) return;
    userApi.stats()
      .then(d => {
        setCurrentStreak(d.stats.currentStreak);
        setBestStreak(d.stats.bestStreak);
      })
      .catch(err => console.error('Stats error:', err));
  }, [lastTripSummary]);

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

  // Compute average score across recent trips
  useEffect(() => {
    if (recentTrips && recentTrips.length > 0) {
      const sum = recentTrips.reduce((acc, trip) => acc + (trip.avgScore ?? trip.score ?? 0), 0);
      setAvgScore(Math.round(sum / recentTrips.length));
    } else {
      setAvgScore(null);
    }
  }, [recentTrips]);

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
        <DashboardHeader userName={user.name || ''} currentStreak={currentStreak} bestStreak={bestStreak} />

        {/* Level & Points Card */}
        <DashboardHero
          user={user}
          avgScore={avgScore}
          lang={lang}
        />

        {/* Quick Summary Grid */}
        <StatsGrid
          columns={3}
          variant="compact"
          items={[
            { icon: ICONS.trips,    value: recentTrips.length,                          label: t('stats.totalTrips') },
            { icon: ICONS.distance, value: formatDistance(user.totalDistance || 0, lang), label: t('stats.totalDistance') },
            { icon: ICONS.points,   value: user.totalPoints.toLocaleString(),             label: t('common.points') },
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
        trip={lastTripSummary}
        onClose={handleCloseSummary}
        onViewDetails={handleViewDetails}
        currentStreak={currentStreak}
        bestStreak={bestStreak}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  ctaBtn: { marginVertical: SPACING.lg },
});
