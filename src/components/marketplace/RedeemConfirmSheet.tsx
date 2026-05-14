import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS, SPACING, TYPOGRAPHY } from '@/constants/theme';
import { useTranslation } from '@/hooks/useTranslation';
import type { Reward } from '@/types';

interface RedeemConfirmSheetProps {
  reward: Reward;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
  lang: string;
}

export const RedeemConfirmSheet: React.FC<RedeemConfirmSheetProps> = ({
  reward, onConfirm, onCancel, loading, lang,
}) => {
  const { t } = useTranslation();

  return (
    <View style={StyleSheet.absoluteFillObject}>
      <TouchableOpacity style={styles.overlay} onPress={onCancel} activeOpacity={1} />
      <View style={styles.confirmSheet}>
        <Text style={styles.confirmEmoji}>{reward.imageEmoji}</Text>
        <Text style={styles.confirmTitle}>
          {lang === 'he' ? reward.titleHe : (reward.titleEn || reward.titleHe)}
        </Text>
        <Text style={styles.confirmCost}>⭐ {reward.costPoints} {t('common.points')}</Text>

        <TouchableOpacity style={styles.confirmBtn} onPress={onConfirm} disabled={loading}>
          <Text style={styles.confirmBtnText}>
            {loading ? '...' : t('marketplace.redeem')}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.85)' },
  confirmSheet: {
    position: 'absolute', top: '25%',
    left: SPACING.lg, right: SPACING.lg,
    backgroundColor: COLORS.card, borderRadius: 24, padding: 32,
    alignItems: 'center', gap: 12,
    borderWidth: 1, borderColor: COLORS.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5, shadowRadius: 20, elevation: 10,
  },
  confirmEmoji:   { fontSize: 48 },
  confirmTitle:   { ...TYPOGRAPHY.h3, textAlign: 'center' },
  confirmCost:    { color: COLORS.brandLight, fontSize: 15 },
  confirmBtn:     {
    backgroundColor: COLORS.brand, borderRadius: 12,
    paddingHorizontal: 32, paddingVertical: 14, marginTop: 8,
    minWidth: 120, alignItems: 'center',
  },
  confirmBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
