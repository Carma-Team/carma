import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Card } from '@/components/ui/Card';
import { TripCard } from './TripCard';
import { useTranslation } from '@/hooks/useTranslation';
import { COLORS, COMMON_STYLES, SPACING } from '@/constants/theme';
import type { Trip } from '@/types';

interface TripListProps {
  trips: Trip[];
  loading?: boolean;
  emptyText?: string;
  maxItems?: number;
}

export function TripList({ trips, loading, emptyText, maxItems }: TripListProps) {
  const { t } = useTranslation();
  const router = useRouter();

  if (loading && trips.length === 0) {
    return <ActivityIndicator color={COLORS.brand} style={{ marginTop: 20 }} />;
  }

  if (trips.length === 0) {
    return (
      <Card style={COMMON_STYLES.emptyState}>
        <Text style={COMMON_STYLES.emptyIcon}>🛣️</Text>
        <Text style={COMMON_STYLES.emptyText}>{emptyText || t('dashboard.noTrips')}</Text>
      </Card>
    );
  }

  const displayedTrips = maxItems ? trips.slice(0, maxItems) : trips;

  return (
    <View style={styles.list}>
      {displayedTrips.map(trip => (
        <TripCard
          key={trip.id}
          trip={trip}
          onPress={() => router.push({ pathname: '/(home)/trip-detail', params: { tripId: trip.id } })}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: SPACING.sm },
});
