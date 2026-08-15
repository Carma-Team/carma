import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from '@/hooks/useTranslation';
import { COLORS, SPACING, TYPOGRAPHY } from '@/constants/theme';
import type { DeviceSupportResult } from '@/lib/deviceSupport';

// Renders full-screen, before login — no navigation offered, matches CAR-23:
// the app is not usable at all outside the region or on an unsupported device.
export default function UnsupportedDeviceScreen({ reason }: { reason: Extract<DeviceSupportResult, { blocked: true }>['reason'] }) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const isRegion = reason === 'region';

  return (
    <View style={[styles.container, { paddingTop: insets.top + SPACING.xl }]}>
      <Ionicons name={isRegion ? 'location-outline' : 'phone-portrait-outline'} size={64} color={COLORS.textMuted} />
      <Text style={styles.title}>{t(isRegion ? 'deviceGate.regionTitle' : 'deviceGate.capabilityTitle')}</Text>
      <Text style={styles.message}>{t(isRegion ? 'deviceGate.regionMessage' : 'deviceGate.capabilityMessage')}</Text>
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
