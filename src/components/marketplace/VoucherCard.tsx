import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Card } from '@/components/ui/Card';
import { COLORS, TYPOGRAPHY } from '@/constants/theme';
import type { Voucher } from '@/navigation/types';

interface VoucherCardProps {
  voucher: Voucher;
  onPress: (voucher: Voucher) => void;
  lang: string;
}

export const VoucherCard: React.FC<VoucherCardProps> = ({ voucher, onPress, lang }) => {
  return (
    <TouchableOpacity onPress={() => onPress(voucher)}>
      <Card>
        <View style={styles.voucherRow}>
          <Text style={styles.emoji}>{voucher.reward?.imageEmoji ?? '🎁'}</Text>
          <View style={styles.content}>
            <Text style={styles.title}>
              {lang === 'he'
                ? (voucher.reward?.title || voucher.reward?.description)
                : (voucher.reward?.titleEn || voucher.reward?.title)}
            </Text>
            <Text style={styles.code}>{voucher.code || voucher.qr_code}</Text>
          </View>
          <Text style={styles.qrArrow}>QR →</Text>
        </View>
      </Card>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  voucherRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12
  },
  emoji: {
    fontSize: 28
  },
  content: {
    flex: 1
  },
  title: {
    ...TYPOGRAPHY.h3,
    fontSize: 14
  },
  code: {
    ...TYPOGRAPHY.caption,
    fontSize: 12
  },
  qrArrow: {
    color: COLORS.brandLight,
    fontSize: 13
  },
});
