import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Card } from '@/components/ui/Card';
import { COMMON_STYLES, TYPOGRAPHY, COLORS } from '@/constants/theme';
import { useTranslation } from '@/hooks/useTranslation';
import type { Voucher } from '@/types';

interface VoucherListProps {
  vouchers: Voucher[];
  onVoucherPress: (voucher: Voucher) => void;
  lang: string;
}

export function VoucherList({ vouchers, onVoucherPress, lang }: VoucherListProps) {
  const { t } = useTranslation();

  if (vouchers.length === 0) {
    return (
      <Card style={COMMON_STYLES.emptyState}>
        <Text style={COMMON_STYLES.emptyIcon}>🎁</Text>
        <Text style={COMMON_STYLES.emptyText}>{t('marketplace.myVouchers')}</Text>
      </Card>
    );
  }

  return (
    <View style={styles.container}>
      {vouchers.map(v => (
        <TouchableOpacity key={v.id} onPress={() => onVoucherPress(v)}>
          <Card>
            <View style={styles.voucherRow}>
              <Text style={styles.emoji}>{v.reward?.imageEmoji ?? '🎁'}</Text>
              <View style={styles.info}>
                <Text style={styles.voucherTitle}>
                  {lang === 'he' ? v.reward?.titleHe : (v.reward?.titleEn || v.reward?.titleHe)}
                </Text>
                <Text style={styles.voucherCode}>{v.code}</Text>
              </View>
              <Text style={styles.qrArrow}>QR →</Text>
            </View>
          </Card>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 10 },
  voucherRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  emoji: { fontSize: 28 },
  info: { flex: 1 },
  voucherTitle: { ...TYPOGRAPHY.h3, fontSize: 14 },
  voucherCode: { ...TYPOGRAPHY.caption, fontSize: 12 },
  qrArrow: { color: COLORS.brandLight, fontSize: 13 },
});
