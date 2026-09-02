import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { Button } from '@/components/ui/Button';
import { TripList } from '@/components/driving/TripList';
import { useTranslation } from '@/hooks/useTranslation';
import { COMMON_STYLES, SPACING } from '@/constants/theme';
import type { Trip } from '@/types';

// How many trips the section shows before the driver asks for more, and how many
// each press adds. Product-tunable — the only reason it is 5 is that a taller
// list pushes the start-trip button off the first screen on a small handset.
const BATCH_SIZE = 5;

interface RecentTripsSectionProps {
  trips: Trip[];
}

export function RecentTripsSection({ trips }: RecentTripsSectionProps) {
  const { t } = useTranslation();
  const [visibleCount, setVisibleCount] = useState(BATCH_SIZE);

  return (
    <View style={COMMON_STYLES.section}>
      <Text style={COMMON_STYLES.sectionTitle}>{t('dashboard.recentTrips')}</Text>
      <TripList
        trips={trips}
        maxItems={visibleCount}
        emptyText={t('dashboard.noTrips')}
      />
      {/* Every trip is already in memory from AppContext, so this only grows how many
          are rendered — there is nothing to fetch and nothing to wait for. Slicing a
          prefix also means the rows already on screen keep their identity and order. */}
      {trips.length > visibleCount && (
        <Button
          variant="ghost"
          size="md"
          fullWidth
          onPress={() => setVisibleCount(count => count + BATCH_SIZE)}
          style={{ marginTop: SPACING.sm }}
        >
          {t('dashboard.showMore')}
        </Button>
      )}
    </View>
  );
}
