import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Card } from '@/components/ui/Card';
import { COLORS, TYPOGRAPHY } from '@/constants/theme';
import { useTranslation } from '@/hooks/useTranslation';

export interface TripEventItem {
  label: string;
  emoji: string;
  value: number | string;
  bad: boolean;
}

interface TripEventsListProps {
  events: TripEventItem[];
}

export function TripEventsList({ events }: TripEventsListProps) {
  const { t } = useTranslation();

  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>{t('trip.events')}</Text>
      <Card>
        {events.map((ev, i) => (
          <View key={ev.label} style={[styles.eventRow, i < events.length - 1 && styles.eventDivider]}>
            <Text style={styles.eventEmoji}>{ev.emoji}</Text>
            <Text style={styles.eventLabel}>{ev.label}</Text>
            <Text style={[styles.eventValue, { color: ev.bad ? COLORS.danger : COLORS.success }]}>
              {ev.value}
            </Text>
          </View>
        ))}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 16 },
  sectionTitle: { ...TYPOGRAPHY.h3, marginBottom: 8 },
  eventRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 10 },
  eventDivider: { borderBottomWidth: 1, borderBottomColor: COLORS.border },
  eventEmoji: { fontSize: 20, width: 28 },
  eventLabel: { flex: 1, color: COLORS.textMuted, fontSize: 14 },
  eventValue: { fontSize: 15, fontWeight: '700' },
});
