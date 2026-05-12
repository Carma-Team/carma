import React from 'react';
import { ActivityIndicator } from 'react-native';
import { StatsGrid } from '@/components/ui/StatsGrid';
import { COLORS } from '@/constants/theme';
import { formatDistance, formatDuration } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import type { DrivingStats } from '@/navigation/types';

interface AchievementsTabProps {
  stats: DrivingStats | null;
  loading: boolean;
}

export function AchievementsTab({ stats, loading }: AchievementsTabProps) {
  const { t, lang } = useTranslation();

  if (loading && !stats) {
    return <ActivityIndicator color={COLORS.brand} style={{ marginTop: 20 }} />;
  }

  return (
    <StatsGrid
      columns={2}
      items={[
        { emoji: '🚗', label: t('stats.totalTrips'),    value: stats?.totalTrips || 0 },
        { emoji: '📍', label: t('stats.totalDistance'), value: formatDistance(stats?.totalDistance || 0, lang) },
        { emoji: '⭐', label: t('stats.totalPoints'),   value: (stats?.totalPoints || 0).toLocaleString() },
        { emoji: '🎯', label: t('stats.avgScore'),      value: stats?.averageScore || 0 },
        { emoji: '✅', label: t('stats.safeTrips'),     value: stats?.safeTripsCount || 0 },
        { emoji: '⏱️', label: t('stats.totalDuration'), value: formatDuration(stats?.totalDurationSeconds || 0, lang) },
      ]}
    />
  );
}
