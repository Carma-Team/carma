import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useTranslation } from '@/hooks/useTranslation'
import { COLORS } from '@/constants/theme'
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
  const inStock   = reward.stock > 0

  return (
    <Card style={styles.cardContainer}>
      <View style={styles.headerRow}>
        <View style={styles.emojiCircle}>
          <Text style={styles.rewardEmoji}>{reward.imageEmoji}</Text>
        </View>
        <View style={styles.headerText}>
          <Text style={styles.businessName}>{reward.business}</Text>
          <Text style={styles.rewardTitle} numberOfLines={2}>
            {lang === 'he' ? reward.titleHe : (reward.titleEn || reward.titleHe)}
          </Text>
        </View>
      </View>

      <View style={styles.footerRow}>
        <View style={styles.costBadge}>
          <Text style={styles.rewardCost}>⭐ {reward.costPoints} {t('common.points')}</Text>
        </View>

        <Button
          size="sm"
          variant={canAfford && inStock ? 'primary' : 'secondary'}
          disabled={!canAfford || !inStock}
          onPress={() => onRedeem(reward)}
          style={styles.redeemBtn}
          textStyle={styles.redeemBtnText}
        >
          {!inStock ? t('marketplace.outOfStock') : !canAfford ? '🔒' : t('marketplace.redeem')}
        </Button>
      </View>
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
        <Text style={styles.voucherEmoji}>{voucher.reward.imageEmoji}</Text>
        <Text style={styles.voucherRewardTitle}>
          {lang === 'he' ? voucher.reward.titleHe : (voucher.reward.titleEn || voucher.reward.titleHe)}
        </Text>

        <View style={styles.qrPlaceholder}>
          <Text style={styles.qrCode}>{voucher.code}</Text>
          <Text style={styles.qrNote}>{t('marketplace.voucher.scanQR')}</Text>
        </View>

        <Text style={styles.voucherExpiry}>
          {t('marketplace.voucher.expiry')}: {new Date(voucher.expiresAt).toLocaleDateString()}
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
  emojiCircle:      {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  rewardEmoji:      { fontSize: 24 },
  headerText:       { flex: 1, gap: 2 },
  businessName:     { color: COLORS.textMuted, fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  rewardTitle:      { color: '#fff', fontWeight: '700', fontSize: 15, lineHeight: 20 },
  footerRow:        {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 8, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)',
  },
  costBadge:        { backgroundColor: 'rgba(129, 140, 248, 0.1)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  rewardCost:       { color: '#818cf8', fontSize: 12, fontWeight: '700' },
  redeemBtn:        { minWidth: 70, height: 32, paddingHorizontal: 12, paddingVertical: 0, borderRadius: 8, alignSelf: 'flex-end' },
  redeemBtnText:    { fontSize: 13, fontWeight: '700' },
  voucherContent:   { alignItems: 'center', paddingVertical: 16, gap: 12 },
  voucherEmoji:     { fontSize: 48 },
  voucherRewardTitle: { color: '#fff', fontSize: 18, fontWeight: '700', textAlign: 'center' },
  qrPlaceholder:    { width: 160, height: 160, backgroundColor: '#fff', borderRadius: 12, alignItems: 'center', justifyContent: 'center', padding: 8 },
  qrCode:           { color: '#000', fontWeight: '700', fontSize: 13, textAlign: 'center' },
  qrNote:           { color: '#666', fontSize: 10, marginTop: 4 },
  voucherExpiry:    { color: '#94a3b8', fontSize: 13 },
  statusBadge:      { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20 },
})
