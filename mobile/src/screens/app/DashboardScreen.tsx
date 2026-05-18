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
import { formatDistance } from '@/lib/utils';
import ActiveTripScreen from '@/screens/app/ActiveTripScreen';

export default function DashboardScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, recentTrips, isLoading, tripState, startTrip, lastTripSummary, setLastTripSummary } = useApp();
  const { t, lang } = useTranslation();
  const [avgScore, setAvgScore] = useState<number | null>(null);

  // לוגיקת הצגת סיכום נסיעה
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

  // חישוב ציון ממוצע לנסיעות אחרונות
  useEffect(() => {
    if (recentTrips && recentTrips.length > 0) {
      const sum = recentTrips.reduce((acc, trip) => acc + (trip.score || 0), 0);
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

  // אם יש נסיעה פעילה, נציג את מסך הנסיעה במקום הדאשבורד
  if (tripState.isActive) {
    return <ActiveTripScreen />;
  }

  return (
    <View style={[COMMON_STYLES.screen, { paddingTop: Math.max(insets.top, 20) }]}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={COMMON_STYLES.scrollContent}>

        {/* Header Section - מופרד לקומפוננטה */}
        <DashboardHeader userName={user.name || ''} />

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
            { emoji: '🚗', value: recentTrips.length, label: t('stats.totalTrips') },
            { emoji: '📍', value: formatDistance(user.totalDistance || 0, lang), label: t('stats.totalDistance') },
            { emoji: '⭐', value: user.totalPoints.toLocaleString(), label: t('common.points') },
          ]}
        />

        {/* Start Trip Action */}
        <Button
          fullWidth
          size="xl"
          onPress={startTrip}
          style={styles.ctaBtn}
        >
          🚗  {t('dashboard.startTrip')}
        </Button>

        {/* Recent History List - מופרד לקומפוננטה */}
        <RecentTripsSection trips={recentTrips} />

      </ScrollView>

      {/* מודאל סיכום נסיעה */}
      <TripSummaryModal
        visible={showSummary}
        trip={lastTripSummary}
        onClose={handleCloseSummary}
        onViewDetails={handleViewDetails}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  ctaBtn: { marginVertical: SPACING.lg },
});
