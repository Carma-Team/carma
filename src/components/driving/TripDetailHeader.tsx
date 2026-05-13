import React from 'react';
import { TouchableOpacity, Text, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { COLORS, TYPOGRAPHY, SPACING } from '@/constants/theme';
import { useTranslation } from '@/hooks/useTranslation';

interface TripDetailHeaderProps {
  onBack?: () => void;
}

export function TripDetailHeader({ onBack }: TripDetailHeaderProps) {
  const { t } = useTranslation();
  const router = useRouter();

  const handleBack = onBack || (() => router.back());

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={handleBack} style={styles.back}>
        <Text style={styles.backText}>← {t('common.back')}</Text>
      </TouchableOpacity>
      <Text style={TYPOGRAPHY.h2}>{t('trip.summary')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: SPACING.md },
  back: { marginBottom: 8 },
  backText: { color: COLORS.brandLight, fontSize: 15, fontWeight: '600' },
});
