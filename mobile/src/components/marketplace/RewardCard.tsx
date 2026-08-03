import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import QRCode from 'react-native-qrcode-svg'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useTranslation } from '@/hooks/useTranslation'
import { COLORS } from '@/constants/theme'
import { ICONS, CATEGORY_CONFIG, DEFAULT_CATEGORY, type IoniconName } from '@/constants/icons'
import { localize } from '@/lib/utils'
import type { Reward, Voucher } from '@/types'

// ─── RewardCard ───────────────────────────────────────────────────────────────
interface RewardCardProps {
  reward: Reward
  userPoints: number
  onRedeem: (reward: Reward) => void
}

export function RewardCard({ reward, userPoints, onRedeem }: RewardCardProps) {
  const { t, lang } = useTranslation()
  const canAfford = userPoints >= reward.costPoints
  // null is unlimited, so it has to be tested before the comparison: `null > 0`
  // is false, which would render every uncapped reward as sold out.
  const inStock   = reward.available === null || reward.available > 0
  const cat = CATEGORY_CONFIG[reward.category] ?? DEFAULT_CATEGORY

  return (
    <Card style={styles.cardContainer}>
      <View style={styles.headerRow}>
        <View style={[styles.iconCircle, { backgroundColor: cat.bg, borderColor: cat.color + '40' }]}>
          <Ionicons name={cat.icon} size={22} color={cat.color} />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.businessName}>{localize(reward.businessHe ?? reward.business, reward.business, lang)}</Text>
          <Text style={styles.rewardTitle} numberOfLines={2}>
            {localize(reward.titleHe, reward.titleEn, lang)}
          </Text>
        </View>
      </View>

      <View style={styles.footerRow}>
        <View style={styles.costBadge}>
          <Ionicons name={ICONS.points} size={12} color={COLORS.brandLight} style={{ marginRight: 4 }} />
          <Text style={styles.rewardCost}>{reward.costPoints} {t('common.points')}</Text>
        </View>

        <Button
          size="sm"
          variant={canAfford && inStock ? 'primary' : 'secondary'}
          disabled={!canAfford || !inStock}
          onPress={() => onRedeem(reward)}
          style={styles.redeemBtn}
          textStyle={styles.redeemBtnText}
        >
          {!inStock
            ? t('marketplace.outOfStock')
            : !canAfford
            ? <Ionicons name={ICONS.locked} size={14} color={COLORS.textMuted} />
            : t('marketplace.redeem')}
        </Button>
      </View>

      {!canAfford && inStock && (
        <Text style={styles.missingPointsHint}>
          {t('marketplace.missingPoints')} {(reward.costPoints - userPoints).toLocaleString()} {t('common.points')}
        </Text>
      )}
    </Card>
  )
}

// ─── VoucherModal ─────────────────────────────────────────────────────────────
interface VoucherModalProps {
  open: boolean
  voucher: Voucher | null
  onClose: () => void
}

export function VoucherModal({ open, voucher, onClose }: VoucherModalProps) {
  const { t, lang } = useTranslation()
  if (!voucher) return null

  return (
    <Modal open={open} onClose={onClose} title={t('marketplace.voucher.title')}>
      <View style={styles.voucherContent}>
        <View style={styles.voucherIconCircle}>
          <Ionicons
            name={(voucher.reward.imageIcon ?? DEFAULT_CATEGORY.icon) as IoniconName}
            size={48}
            color={COLORS.brand}
          />
        </View>
        <Text style={styles.voucherRewardTitle}>
          {localize(voucher.reward.titleHe, voucher.reward.titleEn, lang)}
        </Text>

        <View style={styles.qrPlaceholder}>
          <QRCode
            value={voucher.qrData}
            size={140}
            backgroundColor="transparent"
            color={COLORS.text}
          />
          <Text style={styles.qrNote}>{t('marketplace.voucher.scanQR')}</Text>
          <Text style={styles.qrCodeText}>{voucher.code}</Text>
        </View>

        <Text style={styles.voucherExpiry}>
          {t('marketplace.voucher.expiry')}: {new Date(voucher.expiresAt).toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-US')}
        </Text>
        <View style={[styles.statusBadge, { backgroundColor: voucher.isUsed ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.15)' }]}>
          <Text style={{ color: voucher.isUsed ? '#ef4444' : '#22c55e', fontWeight: '700' }}>
            {voucher.isUsed ? t('marketplace.voucher.used') : t('marketplace.voucher.active')}
          </Text>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  cardContainer:    { padding: 12, marginBottom: 4 },
  headerRow:        { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
  iconCircle: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
  },
  headerText:       { flex: 1, gap: 2 },
  businessName:     { color: COLORS.textMuted, fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  rewardTitle:      { color: COLORS.text, fontWeight: '700', fontSize: 15, lineHeight: 20 },
  footerRow:        {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 8, borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  costBadge:        { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(99, 102, 241, 0.08)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  rewardCost:       { color: COLORS.brandLight, fontSize: 12, fontWeight: '700' },
  redeemBtn:        { minWidth: 70, height: 32, paddingHorizontal: 12, paddingVertical: 0, borderRadius: 8, alignSelf: 'flex-end' },
  redeemBtnText:    { fontSize: 13, fontWeight: '700' },
  missingPointsHint: { color: '#f59e0b', fontSize: 11, fontWeight: '600', textAlign: 'right', marginTop: 6 },
  voucherContent:   { alignItems: 'center', paddingVertical: 16, gap: 12 },
  voucherIconCircle: { width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(99,102,241,0.1)', alignItems: 'center', justifyContent: 'center' },
  voucherRewardTitle: { color: COLORS.text, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  qrPlaceholder:    { alignItems: 'center', justifyContent: 'center', padding: 12, gap: 8 },
  qrNote:           { color: COLORS.textMuted, fontSize: 11, marginTop: 2 },
  qrCodeText:       { color: COLORS.textMuted, fontSize: 10, fontFamily: 'monospace', letterSpacing: 1 },
  voucherExpiry:    { color: COLORS.textMuted, fontSize: 13 },
  statusBadge:      { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20 },
})
