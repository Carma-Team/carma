import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Card } from '@/components/ui/Card'
import { VOUCHER_STATUS_KEY, isVoucherLive } from '@/components/marketplace/RewardCard'
import { useTranslation } from '@/hooks/useTranslation'
import { COLORS, TYPOGRAPHY, SPACING } from '@/constants/theme'
import { DEFAULT_CATEGORY, type IoniconName } from '@/constants/icons'
import { localize } from '@/lib/utils'
import type { Language, Voucher } from '@/types'

// Numeric and short, matching the expiry line on a reward card rather than the
// spelled-out month `formatDate` produces for a trip row.
const expiryDate = (iso: string, lang: Language) =>
  new Date(iso).toLocaleDateString(lang === 'HE' ? 'he-IL' : 'en-US')

interface VoucherListProps {
  vouchers: Voucher[]
  onVoucherPress: (voucher: Voucher) => void
}

/**
 * Every voucher the driver owns, live ones first.
 *
 * Spent, expired and cancelled vouchers stay on the list rather than disappearing:
 * the code is what a business asks for when a redemption is disputed, and a driver
 * who cannot see one has no way to answer.
 */
export function VoucherList({ vouchers, onVoucherPress }: VoucherListProps) {
  const { t, lang } = useTranslation()

  if (vouchers.length === 0) {
    return <Text style={styles.empty}>{t('marketplace.noVouchers')}</Text>
  }

  // Live first, then newest — a voucher that can still be handed over is the reason
  // the driver opened this list, and sorting by date alone buries it under history.
  const ordered = [...vouchers].sort((a, b) => {
    if (isVoucherLive(a) !== isVoucherLive(b)) return isVoucherLive(a) ? -1 : 1
    return b.createdAt.localeCompare(a.createdAt)
  })

  return (
    <View style={{ gap: 10 }}>
      {ordered.map(voucher => {
        const live = isVoucherLive(voucher)
        return (
          <TouchableOpacity key={voucher.id} onPress={() => onVoucherPress(voucher)} activeOpacity={0.8}>
            <Card style={[styles.card, !live && styles.cardSpent]}>
              <View style={styles.iconCircle}>
                <Ionicons
                  name={(voucher.reward.imageIcon ?? DEFAULT_CATEGORY.icon) as IoniconName}
                  size={22}
                  color={live ? COLORS.brand : COLORS.textMuted}
                />
              </View>

              <View style={styles.details}>
                <Text style={styles.title} numberOfLines={1}>
                  {localize(voucher.reward.titleHe, voucher.reward.titleEn, lang)}
                </Text>
                <Text style={styles.business} numberOfLines={1}>{voucher.reward.business}</Text>
                <Text style={styles.meta}>
                  {voucher.code} · {t('marketplace.voucher.expiry')} {expiryDate(voucher.expiresAt, lang)}
                </Text>
              </View>

              <View style={[styles.badge, { backgroundColor: live ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)' }]}>
                <Text style={[styles.badgeText, { color: live ? '#22c55e' : '#ef4444' }]}>
                  {t(VOUCHER_STATUS_KEY[voucher.status])}
                </Text>
              </View>
            </Card>
          </TouchableOpacity>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  card:       { padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardSpent:  { opacity: 0.55 },
  iconCircle: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  details:    { flex: 1, gap: 2 },
  title:      { ...TYPOGRAPHY.body, fontWeight: '700' },
  business:   { ...TYPOGRAPHY.caption },
  meta:       { ...TYPOGRAPHY.caption, fontSize: 11 },
  badge:      { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  badgeText:  { fontSize: 11, fontWeight: '700' },
  empty:      { ...TYPOGRAPHY.caption, textAlign: 'center', marginTop: SPACING.lg },
})
