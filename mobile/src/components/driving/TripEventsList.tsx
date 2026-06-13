import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { Card } from '@/components/ui/Card';
import { COLORS, TYPOGRAPHY } from '@/constants/theme';
import { useTranslation } from '@/hooks/useTranslation';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

export interface TripEventItem {
  label: string;
  icon: IoniconName;
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
            <Ionicons
              name={ev.icon}
              size={20}
              color={ev.bad ? COLORS.danger : COLORS.textMuted}
              style={styles.eventIcon}
            />
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
  container:    { marginTop: 16 },
  sectionTitle: { ...TYPOGRAPHY.h3, marginBottom: 8 },
  eventRow:     { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 10 },
  eventDivider: { borderBottomWidth: 1, borderBottomColor: COLORS.border },
  eventIcon:    { width: 28 },
  eventLabel:   { flex: 1, color: COLORS.textMuted, fontSize: 14 },
  eventValue:   { fontSize: 15, fontWeight: '700' },
});
