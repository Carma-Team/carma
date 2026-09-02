import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { useTranslation } from '@/hooks/useTranslation';
import { COLORS, COMMON_STYLES } from '@/constants/theme';
import { ICONS } from '@/constants/icons';
import { weeklyScoreTrend } from '@/lib/weeklyTrend';
import type { Trip } from '@/types';

interface WeeklyTrendCardProps {
  trips: Trip[];
}

export function WeeklyTrendCard({ trips }: WeeklyTrendCardProps) {
  const { t } = useTranslation();
  const { thisWeek, delta, tripsThisWeek } = weeklyScoreTrend(trips);

  // Nothing driven this week is the common state for a new driver and for anyone
  // taking a week off, so the card says so rather than disappearing — a card that
  // comes and goes reads as a bug on a screen the driver sees every day.
  const direction = delta === null || delta === 0 ? 'flat' : delta > 0 ? 'up' : 'down';
  const deltaColor =
    direction === 'up' ? COLORS.success : direction === 'down' ? COLORS.danger : COLORS.textMuted;

  return (
    <View style={COMMON_STYLES.section}>
      <Text style={COMMON_STYLES.sectionTitle}>{t('dashboard.thisWeek')}</Text>
      <Card>
        {thisWeek === null ? (
          <Text style={styles.empty}>{t('dashboard.weekNoTrips')}</Text>
        ) : (
          <View style={styles.row}>
            <View>
              <Text style={styles.score}>{thisWeek}</Text>
              <Text style={styles.sub}>
                {tripsThisWeek} {t('dashboard.weekTrips')}
              </Text>
            </View>
            <View style={styles.deltaBox}>
              <Ionicons
                name={direction === 'up' ? ICONS.trendUp : direction === 'down' ? ICONS.trendDown : ICONS.trendFlat}
                size={18}
                color={deltaColor}
              />
              <Text style={[styles.delta, { color: deltaColor }]}>
                {delta === null ? t('dashboard.weekNoComparison') : `${Math.abs(delta)}`}
              </Text>
            </View>
          </View>
        )}
      </Card>
      <Text style={styles.footnote}>{t('dashboard.weekVsLast')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  score:    { color: COLORS.text, fontSize: 32, fontWeight: '700' },
  sub:      { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  deltaBox: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  delta:    { fontSize: 18, fontWeight: '600' },
  empty:    { color: COLORS.textMuted, fontSize: 13 },
  footnote: { color: COLORS.textMuted, fontSize: 11, marginTop: 6 },
});

export default WeeklyTrendCard;
