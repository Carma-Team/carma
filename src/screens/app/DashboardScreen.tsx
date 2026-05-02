import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Progress } from '@/components/ui/Progress';
import { LevelBadge } from '@/components/gamification/LevelBadge';
import { TripCard } from '@/components/driving/TripCard';
import { TripSummaryModal } from '@/components/driving/TripSummaryModal';
import { useApp } from '@/context/AppContext';
import { useTranslation } from '@/hooks/useTranslation';
import { getLevelConfig, getLevelProgress, getPointsToNextLevel } from '@/lib/constants';
import { COLORS, SPACING, TYPOGRAPHY, COMMON_STYLES } from '@/theme';
import { formatDistance } from '@/lib/utils';
import { scoreToColor } from '@/lib/scoring';
import ActiveTripScreen from '@/screens/app/ActiveTripScreen';

/**
 * מסך הדאשבורד הראשי.
 */
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
      <View style={[styles.root, { justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color={COLORS.brand} />
      </View>
    );
  }

  // --- לוגיקת driving lifecycle ---
  // אם יש נסיעה פעילה (בין אם ידנית או בלוטוס), נציג את מסך הנסיעה במקום הדאשבורד.
  // זה מבטיח שהמשתמש לא יכול להיות בדאשבורד בזמן נסיעה.
  if (tripState.isActive) {
    return <ActiveTripScreen />;
  }

  return (
    <View style={[COMMON_STYLES.screen, { paddingTop: Math.max(insets.top, 20) }]}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={COMMON_STYLES.scrollContent}>

        {/* Header Section */}
        <View style={COMMON_STYLES.rowBetween}>
          <View>
            <Text style={styles.welcome}>{t('dashboard.welcome')},</Text>
            <Text style={styles.name}>{user.name.split(' ')[0]} 👋</Text>
          </View>
          <View style={styles.headerRight}>
            <TouchableOpacity
              style={styles.settingsBtn}
              onPress={() => router.push('/(home)/settings')}
            >
              <Text style={styles.settingsIcon}>⚙️</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Level & Points Card */}
        <Card glass glow style={styles.hero}>
          <View style={[COMMON_STYLES.row, { gap: 0 }]}>
            <View style={styles.badgeWrapper}>
              <LevelBadge level={user.level} size="lg" lang={lang} showName />
            </View>
            <View style={styles.heroRight}>
              <View style={styles.scoreRow}>
                <Text style={[styles.score, { color: avgScore !== null ? scoreToColor(avgScore) : COLORS.success }]}>
                  {avgScore ?? '--'}
                </Text>
                <Text style={styles.scoreSub}>{t('dashboard.yourScore')}</Text>
              </View>
              <View style={styles.progressContainer}>
                <Progress
                  value={getLevelProgress(user.points || user.totalPoints, user.level)}
                  color={getLevelConfig(user.level).color}
                  height={6}
                />
                <View style={styles.progressStatsRow}>
                  <Text style={styles.progressPointsText}>
                    {(user.points || user.totalPoints).toLocaleString()} {t('common.points')}
                  </Text>
                  {getPointsToNextLevel(user.points || user.totalPoints, user.level) > 0 && (
                    <Text style={styles.progressPointsText}>
                      {getPointsToNextLevel(user.points || user.totalPoints, user.level)} {t('dashboard.pointsToNextLevel')}
                    </Text>
                  )}
                </View>
              </View>
            </View>
          </View>
        </Card>

        {/* Quick Summary Grid */}
        <View style={COMMON_STYLES.statGrid}>
          <Card padding="none" style={COMMON_STYLES.statCard}>
            <Text style={COMMON_STYLES.statEmoji}>🚗</Text>
            <Text style={COMMON_STYLES.statValue}>{recentTrips.length}</Text>
            <Text style={COMMON_STYLES.statLabel}>{t('stats.totalTrips')}</Text>
          </Card>
          <Card padding="none" style={COMMON_STYLES.statCard}>
            <Text style={COMMON_STYLES.statEmoji}>📍</Text>
            <Text style={COMMON_STYLES.statValue}>{formatDistance(user.totalDistance || 0, lang)}</Text>
            <Text style={COMMON_STYLES.statLabel}>{t('stats.totalDistance')}</Text>
          </Card>
          <Card padding="none" style={COMMON_STYLES.statCard}>
            <Text style={COMMON_STYLES.statEmoji}>⭐</Text>
            <Text style={COMMON_STYLES.statValue}>{user.totalPoints.toLocaleString()}</Text>
            <Text style={COMMON_STYLES.statLabel}>{t('common.points')}</Text>
          </Card>
        </View>

        {/* Start Trip Action */}
        <Button
          fullWidth
          size="xl"
          onPress={startTrip}
          style={styles.ctaBtn}
        >
          🚗  {t('dashboard.startTrip')}
        </Button>

        {/* Recent History List */}
        <View style={COMMON_STYLES.section}>
          <Text style={COMMON_STYLES.sectionTitle}>{t('dashboard.recentTrips')}</Text>

          {recentTrips.length === 0 ? (
            <Card style={COMMON_STYLES.emptyState}>
              <Text style={COMMON_STYLES.emptyIcon}>🛣️</Text>
              <Text style={COMMON_STYLES.emptyText}>{t('dashboard.noTrips')}</Text>
            </Card>
          ) : (
            <View style={styles.tripList}>
              {recentTrips.map(trip => (
                <TripCard
                  key={trip.id}
                  trip={trip}
                  onPress={() => router.push({ pathname: '/(home)/trip-detail', params: { tripId: trip.id } })}
                />
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {/* מודאל סיכום נסיעה - מופיע מעל הכל */}
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
  root:          { flex: 1, backgroundColor: COLORS.dark },
  headerRight:   { flexDirection: 'row', gap: SPACING.sm },
  welcome:       { ...TYPOGRAPHY.caption },
  name:          { ...TYPOGRAPHY.h2, fontSize: 26 },
  settingsBtn:   { width: 40, height: 40, backgroundColor: COLORS.card, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border },
  settingsIcon:  { fontSize: 18 },
  hero:          {
    marginBottom: SPACING.md,
    marginTop: 15,
    paddingVertical: 20,
    paddingHorizontal: 20,
    borderWidth: 0.2,
    borderColor: 'rgba(255,255,255,0.1)'
  },
  badgeWrapper:  {
    marginLeft: 10,
    marginRight: 15,
    transform: [{ scale: 1.0 }]
  },
  heroRight:     { flex: 1, justifyContent: 'center' },
  scoreRow:      { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginBottom: 8 },
  score:         { fontSize: 48, fontWeight: '900' },
  scoreSub:      { ...TYPOGRAPHY.caption, fontSize: 13 },
  progressContainer: { marginHorizontal: 4 },
  progressStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4
  },
  progressPointsText: { ...TYPOGRAPHY.caption, fontSize: 10, color: '#fff' },
  ctaBtn:        { marginVertical: SPACING.lg },
  tripList:      { gap: SPACING.sm },
});
