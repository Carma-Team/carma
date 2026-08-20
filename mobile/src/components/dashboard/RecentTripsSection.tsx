import React from 'react';
import { View, Text } from 'react-native';
import { TripList } from '@/components/driving/TripList';
import { useTranslation } from '@/hooks/useTranslation';
import { COMMON_STYLES } from '@/constants/theme';
import type { Trip } from '@/types';

interface RecentTripsSectionProps {
  trips: Trip[];
}

export function RecentTripsSection({ trips }: RecentTripsSectionProps) {
  const { t } = useTranslation();

  return (
    <View style={COMMON_STYLES.section}>
      <Text style={COMMON_STYLES.sectionTitle}>{t('dashboard.recentTrips')}</Text>
      <TripList
        trips={trips}
        emptyText={t('dashboard.noTrips')}
      />
    </View>
  );
}
