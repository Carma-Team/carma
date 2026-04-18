import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useTranslation } from '@/hooks/useTranslation'
import type { Reward, Voucher } from '@/navigation/types'

// ─── RewardCard ───────────────────────────────────────────────────────────────
interface RewardCardProps {
  reward: Reward
  userPoints: number
  onRedeem: (reward: Reward) => void
}

export function RewardCard({ reward, userPoints, onRedeem }: RewardCardProps) {
  const { t, lang } = useTranslation()
  const canAfford  = userPoints >= reward.pointsCost
  const inStock    = reward.stock > 0

  return (
    <Card>
      <View style={styles.rewardRow}>
        <View style={styles.emojiContainer}>
          <Text style={styles.rewardEmoji}>{reward.imageEmoji}</Text>
        </View>
        <View style={styles.rewardInfo}>
          <Text style={styles.rewardTitle} numberOfLines={1}>
            {lang === 'he' ? reward.title : (reward.titleEn || reward.title)}
          </Text>
          <Text style={styles.rewardBusiness}>🏢 {reward.business}</Text>
          <View style={styles.costBadge}>
            <Text style={styles.rewardCost}>⭐ {reward.pointsCost} {t('common.points')}</Text>
          </View>
        </View>
        <Button
          size="sm"
          variant={canAfford && inStock ? 'primary' : 'secondary'}
          disabled={!canAfford || !inStock}
          onPress={() => onRedeem(reward)}
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
        <Text style={styles.voucherEmoji}>{voucher.reward?.imageEmoji ?? '🎁'}</Text>
        <Text style={styles.voucherRewardTitle}>
          {lang === 'he' ? voucher.reward?.title : (voucher.reward?.titleEn || voucher.reward?.title)}
        </Text>

        {/* Here you need to add a QR code renderer. Install: expo install expo-barcode-generator
            or use react-native-qrcode-svg and pass voucher.qrData as the value. */}
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
  rewardRow:        { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rewardEmoji:      { fontSize: 32 },
  rewardInfo:       { flex: 1 },
  rewardTitle:      { color: '#fff', fontWeight: '600', fontSize: 14 },
  rewardBusiness:   { color: '#94a3b8', fontSize: 12 },
  rewardCost:       { color: '#818cf8', fontSize: 12, marginTop: 2, fontWeight: '600' },
  voucherContent:   { alignItems: 'center', paddingVertical: 16, gap: 12 },
  voucherEmoji:     { fontSize: 48 },
  voucherRewardTitle:{ color: '#fff', fontSize: 18, fontWeight: '700', textAlign: 'center' },
  qrPlaceholder:    { width: 160, height: 160, backgroundColor: '#fff', borderRadius: 12, alignItems: 'center', justifyContent: 'center', padding: 8 },
  qrCode:           { color: '#000', fontWeight: '700', fontSize: 13, textAlign: 'center' },
  qrNote:           { color: '#666', fontSize: 10, marginTop: 4 },
  voucherExpiry:    { color: '#94a3b8', fontSize: 13 },
  statusBadge:      { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20 },
})
