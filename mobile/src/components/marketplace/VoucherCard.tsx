import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { COLORS, TYPOGRAPHY } from '@/constants/theme';
import { CATEGORY_CONFIG, DEFAULT_CATEGORY } from '@/constants/icons';
import { localize } from '@/lib/utils';
import type { Voucher } from '@/types';

interface VoucherCardProps {
  voucher: Voucher;
  onPress: (voucher: Voucher) => void;
  lang: string;
}

export const VoucherCard: React.FC<VoucherCardProps> = ({ voucher, onPress, lang }) => {
  const cat = CATEGORY_CONFIG[voucher.reward.category] ?? DEFAULT_CATEGORY;

  return (
    <TouchableOpacity onPress={() => onPress(voucher)}>
      <Card>
        <View style={styles.voucherRow}>
          <View style={[styles.iconCircle, { backgroundColor: cat.bg, borderColor: cat.color + '40' }]}>
            <Ionicons name={cat.icon} size={20} color={cat.color} />
          </View>
          <View style={styles.content}>
            <Text style={styles.title}>
              {localize(voucher.reward.titleHe, voucher.reward.titleEn, lang)}
            </Text>
            <Text style={styles.code}>{voucher.code}</Text>
          </View>
          <Text style={styles.qrArrow}>QR →</Text>
        </View>
      </Card>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  voucherRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconCircle: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
  },
  content:    { flex: 1 },
  title:      { ...TYPOGRAPHY.h3, fontSize: 14 },
  code:       { ...TYPOGRAPHY.caption, fontSize: 12 },
  qrArrow:    { color: COLORS.brandLight, fontSize: 13 },
});
