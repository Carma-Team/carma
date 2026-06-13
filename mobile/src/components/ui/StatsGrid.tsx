import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { Ionicons, FontAwesome5 } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { Card } from './Card';
import { COLORS, COMMON_STYLES, SPACING, TYPOGRAPHY } from '@/constants/theme';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

export interface StatItem {
  label: string;
  value: string | number;
  icon: IoniconName;
  fa5Icon?: string;
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
            } as ViewStyle,
            isCompact ? styles.compactCard : undefined
          ]}
        >
          {item.fa5Icon ? (
            <FontAwesome5
              name={item.fa5Icon}
              size={isCompact ? 16 : 24}
              color={COLORS.brandLight}
              style={{ marginBottom: isCompact ? 2 : 6 }}
            />
          ) : (
            <Ionicons
              name={item.icon}
              size={isCompact ? 18 : 28}
              color={COLORS.brandLight}
              style={{ marginBottom: isCompact ? 2 : 6 }}
            />
          )}
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
    backgroundColor: COLORS.card,
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
