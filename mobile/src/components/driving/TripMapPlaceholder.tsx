import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { Card } from '@/components/ui/Card';
import { COLORS, TYPOGRAPHY } from '@/constants/theme';

export function TripMapPlaceholder() {
  return (
    <Card glass style={styles.mapPlaceholder}>
      <Text style={styles.icon}>🗺️</Text>
      <Text style={styles.text}>תצוגת מפה תתווסף בקרוב</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  mapPlaceholder: {
    marginTop: 20,
    paddingVertical: 40,
    alignItems: 'center',
    borderStyle: 'dashed',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  icon: { fontSize: 30 },
  text: { ...TYPOGRAPHY.caption, color: COLORS.textMuted, marginTop: 10 },
});
