import React from 'react';
import { View, Text, ActivityIndicator, FlatList, StyleSheet, ViewStyle } from 'react-native';
import { Card } from '@/components/ui/Card';
import { LeaderboardRow } from '@/components/social/LeaderboardRow';
import { COLORS, COMMON_STYLES } from '@/constants/theme';
import { useTranslation } from '@/hooks/useTranslation';
import type { FollowStatus, LeaderboardEntry } from '@/types';

interface LeaderboardListProps {
  entries: LeaderboardEntry[];
  loading: boolean;
  currentUserId: string;
  showFollowButton?: boolean;
  onFollow?: (userId: string, currentStatus: FollowStatus) => void;
  style?: ViewStyle;
}

export function LeaderboardList({
  entries,
  loading,
  currentUserId,
  showFollowButton = false,
  onFollow,
  style,
}: LeaderboardListProps) {
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
      <FlatList
        data={entries}
        keyExtractor={e => e.id}
        scrollEnabled={false}
        initialNumToRender={15}
        maxToRenderPerBatch={10}
        removeClippedSubviews
        ItemSeparatorComponent={() => <View style={styles.divider} />}
        renderItem={({ item }) => (
          <LeaderboardRow
            entry={item}
            isCurrentUser={item.userId === currentUserId}
            showFollowButton={showFollowButton}
            onFollow={onFollow}
          />
        )}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  loader:   { marginTop: 40 },
  listCard: { overflow: 'hidden' },
  divider:  { height: 1, backgroundColor: COLORS.border },
});
