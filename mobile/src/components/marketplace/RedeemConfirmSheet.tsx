import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, TYPOGRAPHY } from '@/constants/theme';
import { ICONS, CATEGORY_CONFIG, DEFAULT_CATEGORY } from '@/constants/icons';
import { useTranslation } from '@/hooks/useTranslation';
import { localize } from '@/lib/utils';
import type { Reward, Language } from '@/types';

interface RedeemConfirmSheetProps {
  reward: Reward;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
  lang: Language;
}

export const RedeemConfirmSheet: React.FC<RedeemConfirmSheetProps> = ({
  reward, onConfirm, onCancel, loading, lang,
}) => {
  const { t } = useTranslation();
  const cat = CATEGORY_CONFIG[reward.category] ?? DEFAULT_CATEGORY;

  return (
    <View style={StyleSheet.absoluteFillObject}>
      <TouchableOpacity style={styles.overlay} onPress={onCancel} activeOpacity={1} />
      <View style={styles.confirmSheet}>

        {/* Close button */}
        <TouchableOpacity style={styles.closeBtn} onPress={onCancel} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="close" size={20} color={COLORS.textMuted} />
        </TouchableOpacity>

        {/* Category icon */}
        <View style={[styles.iconCircle, { backgroundColor: cat.bg, borderColor: cat.color + '40' }]}>
          <Ionicons name={cat.icon} size={32} color={cat.color} />
        </View>

        <Text style={styles.confirmTitle}>
          {localize(reward.titleHe, reward.titleEn, lang)}
        </Text>
        <View style={styles.confirmCostRow}>
          <Ionicons name={ICONS.points} size={14} color={COLORS.brandLight} style={{ marginEnd: 4 }} />
          <Text style={styles.confirmCost}>{reward.costPoints} {t('common.points')}</Text>
        </View>

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
  closeBtn: {
    position: 'absolute', top: 14, left: 16,
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center', justifyContent: 'center',
  },
  iconCircle: {
    width: 72, height: 72, borderRadius: 36,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, marginTop: 8,
  },
  confirmTitle:   { ...TYPOGRAPHY.h3, textAlign: 'center' },
  confirmCostRow: { flexDirection: 'row', alignItems: 'center' },
  confirmCost:    { color: COLORS.brandLight, fontSize: 15 },
  confirmBtn:     {
    backgroundColor: COLORS.brand, borderRadius: 12,
    paddingHorizontal: 32, paddingVertical: 14, marginTop: 8,
    minWidth: 120, alignItems: 'center',
  },
  confirmBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
