import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from '@/hooks/useTranslation';
import { COLORS, SPACING, TYPOGRAPHY } from '@/constants/theme';

// Renders full-screen, before login — no navigation offered. Capability-only:
// region is no longer checked at startup (CAR-23 — enforced at trip start instead).
export default function UnsupportedDeviceScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  return (
    <View style={[styles.container, { paddingTop: insets.top + SPACING.xl }]}>
      <Ionicons name="phone-portrait-outline" size={64} color={COLORS.textMuted} />
      <Text style={styles.title}>{t('deviceGate.capabilityTitle')}</Text>
      <Text style={styles.message}>{t('deviceGate.capabilityMessage')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.dark,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.xl,
    gap: SPACING.md,
  },
  title: { ...TYPOGRAPHY.h2, textAlign: 'center' },
  message: { ...TYPOGRAPHY.body, color: COLORS.textMuted, textAlign: 'center' },
});
