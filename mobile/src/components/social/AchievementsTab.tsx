import React from 'react';
import { ActivityIndicator } from 'react-native';
import { StatsGrid } from '@/components/ui/StatsGrid';
import { COLORS } from '@/constants/theme';
import { ICONS } from '@/constants/icons';
import { formatDistance, formatDuration } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import type { DrivingStats } from '@/types';

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
        { icon: ICONS.trips,     label: t('stats.totalTrips'),    value: stats?.totalTrips || 0 },
        { icon: ICONS.distance,  label: t('stats.totalDistance'), value: formatDistance(stats?.totalDistance || 0, lang) },
        { icon: ICONS.points,    label: t('stats.totalPoints'),   value: (stats?.totalPoints || 0).toLocaleString() },
        { icon: ICONS.avgScore, fa5Icon: 'map-marked-alt', label: t('stats.avgScore'), value: stats?.averageScore || 0 },
        { icon: ICONS.safeTrips, label: t('stats.safeTrips'),     value: stats?.safeTripsCount || 0 },
        { icon: ICONS.duration,  label: t('stats.totalDuration'), value: formatDuration(stats?.totalDurationSeconds || 0, lang) },
      ]}
    />
  );
}
