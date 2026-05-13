import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, TYPOGRAPHY, SPACING } from '@/constants/theme';
import { useTranslation } from '@/hooks/useTranslation';

export function ActiveTripHeader() {
  const { t } = useTranslation();

  return (
    <View style={styles.header}>
      <Text style={styles.title}>{t('trip.activeTrip')}</Text>
      <View style={styles.liveIndicator}>
        <View style={styles.dot} />
        <Text style={styles.liveText}>LIVE</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: SPACING.lg,
    marginTop: 10
  },
  title: { ...TYPOGRAPHY.h2, color: '#fff' },
  liveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)'
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.danger, marginEnd: 6 },
  liveText: { color: COLORS.danger, fontSize: 12, fontWeight: '900' },
});
