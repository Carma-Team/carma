import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Alert, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { TripList } from '@/components/driving/TripList';
import { useApp } from '@/context/AppContext';
import { useTranslation } from '@/hooks/useTranslation';
import { COLORS, COMMON_STYLES, SPACING } from '@/constants/theme';
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
  const { clearTripHistory } = useApp();
  const [visibleCount, setVisibleCount] = useState(BATCH_SIZE);

  const confirmClear = () => {
    Alert.alert(
      t('dashboard.deleteAllTrips'),
      t('dashboard.deleteAllConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.confirm'), style: 'destructive', onPress: () => { clearTripHistory(); } },
      ],
    );
  };

  return (
    <View style={COMMON_STYLES.section}>
      <View style={styles.header}>
        <Text style={COMMON_STYLES.sectionTitle}>{t('dashboard.recentTrips')}</Text>
        {trips.length > 0 && (
          <TouchableOpacity
            onPress={confirmClear}
            accessibilityLabel={t('dashboard.deleteAllTrips')}
            hitSlop={8}
          >
            <Ionicons name="trash-outline" size={20} color={COLORS.danger} />
          </TouchableOpacity>
        )}
      </View>

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

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
