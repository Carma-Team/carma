import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Alert, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { TripList } from '@/components/driving/TripList';
import { useApp } from '@/context/AppContext';
import { useTranslation } from '@/hooks/useTranslation';
import { COLORS, COMMON_STYLES, SPACING, TYPOGRAPHY } from '@/constants/theme';
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
  const { deleteTrips } = useApp();
  const [visibleCount, setVisibleCount] = useState(BATCH_SIZE);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Select-all covers what is on screen, not the whole history: offering to delete
  // trips the driver has not been shown is a different, much larger promise.
  const visibleTrips = trips.slice(0, visibleCount);
  const allSelected = visibleTrips.length > 0 && visibleTrips.every(trip => selected.has(trip.id));

  const exitSelection = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const toggle = (tripId: string) =>
    setSelected(prev => {
      const next = new Set(prev);
      if (!next.delete(tripId)) next.add(tripId);
      return next;
    });

  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(visibleTrips.map(trip => trip.id)));

  const confirmDelete = () => {
    Alert.alert(
      t('dashboard.deleteTrips'),
      t('dashboard.deleteSelectedConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.confirm'),
          style: 'destructive',
          onPress: async () => {
            await deleteTrips([...selected]);
            exitSelection();
          },
        },
      ],
    );
  };

  return (
    <View style={COMMON_STYLES.section}>
      <View style={styles.header}>
        <Text style={COMMON_STYLES.sectionTitle}>{t('dashboard.recentTrips')}</Text>
        {trips.length > 0 && (
          <TouchableOpacity
            onPress={() => (selecting ? exitSelection() : setSelecting(true))}
            accessibilityLabel={t('dashboard.deleteTrips')}
            hitSlop={8}
          >
            <Ionicons
              name={selecting ? 'close' : 'trash-outline'}
              size={20}
              color={selecting ? COLORS.textMuted : COLORS.danger}
            />
          </TouchableOpacity>
        )}
      </View>

      {selecting && (
        <View style={styles.selectionBar}>
          <TouchableOpacity onPress={toggleAll} hitSlop={8}>
            <Text style={styles.selectAll}>
              {allSelected ? t('dashboard.clearSelection') : t('dashboard.selectAll')}
            </Text>
          </TouchableOpacity>
          <Text style={styles.count}>
            {t('dashboard.selectedCount').replace('{count}', String(selected.size))}
          </Text>
        </View>
      )}

      <TripList
        trips={trips}
        maxItems={visibleCount}
        emptyText={t('dashboard.noTrips')}
        selectable={selecting}
        selectedIds={selected}
        onToggleSelect={toggle}
      />

      {selecting && (
        <Button
          variant="danger"
          size="md"
          fullWidth
          disabled={selected.size === 0}
          onPress={confirmDelete}
          style={{ marginTop: SPACING.sm }}
        >
          {t('dashboard.deleteTrips')}
        </Button>
      )}

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
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  selectionBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACING.sm },
  selectAll:    { ...TYPOGRAPHY.caption, color: COLORS.brand, fontWeight: '700' },
  count:        { ...TYPOGRAPHY.caption },
});
