import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Card } from '@/components/ui/Card';
import { COLORS, TYPOGRAPHY, SPACING } from '@/constants/theme';
import { useTranslation } from '@/hooks/useTranslation';

interface MarketplaceHeaderProps {
  points: number;
}

export function MarketplaceHeader({ points }: MarketplaceHeaderProps) {
  const { t } = useTranslation();

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>{t('marketplace.title')}</Text>
      <Text style={styles.subtitle}>{t('marketplace.subtitle')}</Text>

      <Card glass style={styles.pointsCard}>
        <Text style={styles.pointsValue}>{points.toLocaleString()}</Text>
        <Text style={styles.pointsLabel}>{t('common.points')}</Text>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: SPACING.md },
  heading: { ...TYPOGRAPHY.h2 },
  subtitle: { ...TYPOGRAPHY.caption, marginBottom: 12 },
  pointsCard: { alignItems: 'center', paddingVertical: 12 },
  pointsValue: { color: COLORS.brandLight, fontSize: 32, fontWeight: '900' },
  pointsLabel: { ...TYPOGRAPHY.caption, fontSize: 12 },
});
