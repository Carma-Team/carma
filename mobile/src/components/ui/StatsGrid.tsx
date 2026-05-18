import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Card } from './Card';
import { COMMON_STYLES, SPACING, TYPOGRAPHY } from '@/constants/theme';

export interface StatItem {
  label: string;
  value: string | number;
  emoji: string;
}

interface StatsGridProps {
  items: StatItem[];
  columns?: number;
  variant?: 'default' | 'compact';
}

export function StatsGrid({ items, columns = 2, variant = 'default' }: StatsGridProps) {
  const isCompact = variant === 'compact';
  const itemWidth = `${(100 / columns) - 2.5}%`;

  return (
    <View style={[
      COMMON_STYLES.statGrid,
      isCompact && { gap: SPACING.xs, flexWrap: 'nowrap' }
    ]}>
      {items.map((item, index) => (
        <Card
          key={index}
          padding="none"
          style={[
            COMMON_STYLES.statCard,
            {
              width: isCompact ? 'auto' : itemWidth,
              minWidth: isCompact ? 0 : itemWidth,
              flex: isCompact ? 1 : 0,
              marginBottom: isCompact ? 0 : SPACING.sm
            },
            isCompact && styles.compactCard
          ]}
        >
          <Text style={[COMMON_STYLES.statEmoji, isCompact && styles.compactEmoji]}>
            {item.emoji}
          </Text>
          <Text style={[COMMON_STYLES.statValue, isCompact && styles.compactValue]}>
            {item.value}
          </Text>
          <Text style={[COMMON_STYLES.statLabel, isCompact && styles.compactLabel]}>
            {item.label}
          </Text>
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  compactCard: {
    minHeight: 65,
    padding: SPACING.xs,
    borderColor: 'transparent',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  compactEmoji: {
    fontSize: 18,
    marginBottom: 0,
  },
  compactValue: {
    fontSize: 14,
    fontWeight: '700',
  },
  compactLabel: {
    fontSize: 9,
    marginTop: -2,
  },
});
