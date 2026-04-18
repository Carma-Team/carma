import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Progress } from '@/components/ui/Progress';
import { LevelBadge } from '@/components/gamification/LevelBadge';
import { TripCard } from '@/components/driving/TripCard';
import { useApp } from '@/context/AppContext';
import { useTranslation } from '@/hooks/useTranslation';
import { getLevelConfig, getLevelProgress, getPointsToNextLevel, COLORS } from '@/lib/constants';
import { formatDistance } from '@/lib/utils';
import { scoreToColor } from '@/lib/scoring';

export default function DashboardScreen() {
  const router = useRouter();
  const { user, recentTrips, isLoading } = useApp();
  const { t, lang } = useTranslation();
  const [avgScore, setAvgScore] = useState<number | null>(null);

  useEffect(() => {
    if (recentTrips && recentTrips.length > 0) {
      const sum = recentTrips.reduce((acc, trip) => acc + (trip.score || 0), 0);
      setAvgScore(Math.round(sum / recentTrips.length));
    } else {
      setAvgScore(95);
    }
  }, [recentTrips]);

  if (!user || isLoading) {
    return (
      <View style={[styles.root, { justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color={COLORS.brand} />
      </View>
    );
  }

  const levelConfig   = getLevelConfig(user.level);
  const levelProgress = getLevelProgress(user.totalPoints, user.level);
  const pointsToNext  = getPointsToNextLevel(user.totalPoints, user.level);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.welcome}>{t('dashboard.welcome')},</Text>
          <Text style={styles.name}>{user.name.split(' ')[0]} 👋</Text>
        </View>
        <TouchableOpacity style={styles.bell}>
          <Text style={styles.bellIcon}>🔔</Text>
        </TouchableOpacity>
      </View>

      {/* Score + Level hero */}
      <Card glass glow style={styles.hero}>
        <View style={styles.heroRow}>
          <LevelBadge level={user.level} size="lg" lang={lang} showName />
          <View style={styles.heroRight}>
            <View style={styles.scoreRow}>
              <Text style={[styles.score, { color: avgScore !== null ? scoreToColor(avgScore) : COLORS.success }]}>
                {avgScore ?? '--'}
              </Text>
              <Text style={styles.scoreSub}>{t('dashboard.yourScore')}</Text>
            </View>
            <Progress
              value={levelProgress}
              color={levelConfig.color}
              height={12}
            />
            <Text style={styles.progressText}>
              {user.totalPoints.toLocaleString()} {t('common.points')}
              {pointsToNext > 0 && ` · ${pointsToNext} לדרגה הבאה`}
            </Text>
          </View>
        </View>
      </Card>

      {/* Quick stats */}
      <View style={styles.statsRow}>
        <Card padding="sm" style={styles.statCard}>
          <Text style={styles.statEmoji}>🚗</Text>
          <Text style={styles.statValue}>{recentTrips.length}</Text>
          <Text style={styles.statLabel}>נסיעות</Text>
        </Card>
        <Card padding="sm" style={styles.statCard}>
          <Text style={styles.statEmoji}>📍</Text>
          <Text style={styles.statValue}>{formatDistance(user.totalDistance || 0, lang)}</Text>
          <Text style={styles.statLabel}>מרחק</Text>
        </Card>
        <Card padding="sm" style={styles.statCard}>
          <Text style={styles.statEmoji}>⭐</Text>
          <Text style={styles.statValue}>{user.totalPoints.toLocaleString()}</Text>
          <Text style={styles.statLabel}>נקודות</Text>
        </Card>
      </View>

      {/* Start trip CTA */}
      <Button fullWidth size="xl" onPress={() => router.push('/trip')} style={styles.ctaBtn}>
        🚗  {t('dashboard.startTrip')}
      </Button>

      {/* Recent trips */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('dashboard.recentTrips')}</Text>

        {recentTrips.length === 0 ? (
          <Card style={styles.empty}>
            <Text style={styles.emptyIcon}>🛣️</Text>
            <Text style={styles.emptyText}>{t('dashboard.noTrips')}</Text>
          </Card>
        ) : (
          <View style={styles.tripList}>
            {recentTrips.map(trip => (
              <TripCard key={trip.id} trip={trip} onPress={() => {}} />
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root:          { flex: 1, backgroundColor: COLORS.dark },
  content:       { padding: 16, paddingBottom: 100 },
  header:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  welcome:       { color: COLORS.textMuted, fontSize: 13 },
  name:          { color: '#fff', fontSize: 26, fontWeight: '900' },
  bell:          { width: 40, height: 40, backgroundColor: COLORS.card, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border },
  bellIcon:      { fontSize: 18 },
  hero:          { marginBottom: 12 },
  heroRow:       { flexDirection: 'row', alignItems: 'center', gap: 16 },
  heroRight:     { flex: 1, gap: 6 },
  scoreRow:      { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  score:         { fontSize: 48, fontWeight: '900' },
  scoreSub:      { color: COLORS.textMuted, fontSize: 13 },
  progressText:  { color: COLORS.textMuted, fontSize: 11, marginTop: 2 },
  statsRow:      { flexDirection: 'row', gap: 10, marginBottom: 12 },
  statCard:      { flex: 1, alignItems: 'center' },
  statEmoji:     { fontSize: 20, marginBottom: 4 },
  statValue:     { color: '#fff', fontWeight: '700', fontSize: 14 },
  statLabel:     { color: COLORS.textMuted, fontSize: 11, marginTop: 2 },
  ctaBtn:        { marginBottom: 20 },
  section:       { gap: 10 },
  sectionTitle:  { color: '#fff', fontWeight: '700', fontSize: 16 },
  empty:         { alignItems: 'center', paddingVertical: 32 },
  emptyIcon:     { fontSize: 40, marginBottom: 8 },
  emptyText:     { color: COLORS.textMuted, fontSize: 14 },
  tripList:      { gap: 10 },
});
