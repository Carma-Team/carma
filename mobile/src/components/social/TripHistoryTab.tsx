import React from 'react';
import { TripList } from '@/components/driving/TripList';
import { useTranslation } from '@/hooks/useTranslation';
import type { Trip } from '@/types';

interface TripHistoryTabProps {
  trips: Trip[];
  loading: boolean;
}

export function TripHistoryTab({ trips, loading }: TripHistoryTabProps) {
  const { t } = useTranslation();

  return (
    <TripList
      trips={trips}
      loading={loading}
      emptyText={t('profile.noTrips')}
    />
  );
}
