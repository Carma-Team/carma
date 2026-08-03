import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { COMMON_STYLES, TYPOGRAPHY, COLORS } from '@/constants/theme';
import { useTranslation } from '@/hooks/useTranslation';
import { localize } from '@/lib/utils';
import { ICONS, DEFAULT_CATEGORY, type IoniconName } from '@/constants/icons';
import type { Voucher, Language } from '@/types';

interface VoucherListProps {
  vouchers: Voucher[];
  onVoucherPress: (voucher: Voucher) => void;
  lang: Language;
}

export function VoucherList({ vouchers, onVoucherPress, lang }: VoucherListProps) {
  const { t } = useTranslation();

  if (vouchers.length === 0) {
    return (
      <Card style={COMMON_STYLES.emptyState}>
        <Ionicons name={ICONS.noRewards} size={40} color={COLORS.textMuted} style={{ marginBottom: 8 }} />
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
              <Ionicons
                name={(v.reward?.imageIcon ?? DEFAULT_CATEGORY.icon) as IoniconName}
                size={28}
                color={COLORS.brand}
              />
              <View style={styles.info}>
                <Text style={styles.voucherTitle}>
                  {localize(v.reward?.titleHe ?? '', v.reward?.titleEn, lang)}
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
  info: { flex: 1 },
  voucherTitle: { ...TYPOGRAPHY.h3, fontSize: 14 },
  voucherCode: { ...TYPOGRAPHY.caption, fontSize: 12 },
  qrArrow: { color: COLORS.brandLight, fontSize: 13 },
});
