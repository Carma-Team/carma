import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet, ViewStyle } from 'react-native';
import { Card } from '@/components/ui/Card';
import { LeaderboardRow } from '@/components/social/LeaderboardRow';
import { COLORS, COMMON_STYLES, TYPOGRAPHY, SPACING } from '@/constants/theme';
import { useTranslation } from '@/hooks/useTranslation';
import type { LeaderboardEntry } from '@/types';

interface LeaderboardListProps {
  entries: LeaderboardEntry[];
  loading: boolean;
  currentUserId: string;
  style?: ViewStyle;
}

export function LeaderboardList({ entries, loading, currentUserId, style }: LeaderboardListProps) {
  const { t } = useTranslation();

  if (loading) {
    return <ActivityIndicator color={COLORS.brand} style={[styles.loader, style]} />;
  }

  if (entries.length === 0) {
    return (
      <Card style={[COMMON_STYLES.emptyState, style]}>
        <Text style={COMMON_STYLES.emptyIcon}>👥</Text>
        <Text style={COMMON_STYLES.emptyText}>{t('leaderboard.noFriends')}</Text>
      </Card>
    );
  }

  return (
    <Card padding="none" style={[styles.listCard, style]}>
      {entries.map((entry, i) => (
        <View key={entry.id}>
          {i > 0 && <View style={styles.divider} />}
          <LeaderboardRow
            entry={entry}
            isCurrentUser={entry.userId === currentUserId}
          />
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  loader: { marginTop: 40 },
  listCard: { overflow: 'hidden' },
  divider: { height: 1, backgroundColor: COLORS.border },
});
