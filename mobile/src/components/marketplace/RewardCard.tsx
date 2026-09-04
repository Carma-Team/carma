import React, { useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import QRCode from 'react-native-qrcode-svg'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useTranslation } from '@/hooks/useTranslation'
import { COLORS } from '@/constants/theme'
import { ICONS, CATEGORY_CONFIG, DEFAULT_CATEGORY, type IoniconName } from '@/constants/icons'
import { localize } from '@/lib/utils'
import { isSoldOut } from '@/lib/rewardStock'
import type { Language, Reward, Voucher } from '@/types'

// ─── RewardCard ───────────────────────────────────────────────────────────────
// The server caps how many vouchers a driver may hold live against one reward
// (CAR-71) and stays the authority on it. The card mirrors the ceiling so the
// third attempt is not offered at all, instead of being refused after the tap.
const MAX_LIVE_VOUCHERS = 2

// Numeric and short on purpose. `formatDate` in lib/utils spells the month out,
// which is right for a trip row and too wide for the voucher line on a card.
const expiryDate = (iso: string, lang: Language) =>
  new Date(iso).toLocaleDateString(lang === 'HE' ? 'he-IL' : 'en-US')

interface RewardCardProps {
  reward: Reward
  userPoints: number
  /** Live (pending) vouchers this driver holds against this reward — 0, 1 or 2. */
  vouchers: Voucher[]
  onRedeem: (reward: Reward) => void
  onVoucherPress: (voucher: Voucher) => void
}

export function RewardCard({ reward, userPoints, vouchers, onRedeem, onVoucherPress }: RewardCardProps) {
  const { t, lang } = useTranslation()
  const canAfford = userPoints >= reward.costPoints
  const inStock   = !isSoldOut(reward.available)
  const atCap     = vouchers.length >= MAX_LIVE_VOUCHERS
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
          variant={canAfford && inStock && !atCap ? 'primary' : 'secondary'}
          disabled={!canAfford || !inStock || atCap}
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

      {!canAfford && inStock && !atCap && (
        <Text style={styles.missingPointsHint}>
          {t('marketplace.missingPoints')} {(reward.costPoints - userPoints).toLocaleString()} {t('common.points')}
        </Text>
      )}

      {atCap && <Text style={styles.missingPointsHint}>{t('marketplace.voucherCap')}</Text>}

      {vouchers.length > 0 && (
        <View style={styles.voucherStrip}>
          {vouchers.map(v => (
            <TouchableOpacity key={v.id} style={styles.voucherRow} onPress={() => onVoucherPress(v)}>
              <Ionicons name={ICONS.active} size={14} color={COLORS.brand} />
              <Text style={styles.voucherCode} numberOfLines={1}>{v.code}</Text>
              <Text style={styles.voucherExpiryInline}>
                {t('marketplace.voucher.expiry')} {expiryDate(v.expiresAt, lang)}
              </Text>
              <Text style={styles.qrArrow}>QR →</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </Card>
  )
}

// ─── VoucherModal ─────────────────────────────────────────────────────────────

// `isUsed` only separates redeemed from everything else, so an expired or cancelled
// voucher used to read as active. The status field carries all four states.
export const VOUCHER_STATUS_KEY: Record<Voucher['status'], string> = {
  pending:   'marketplace.voucher.active',
  used:      'marketplace.voucher.used',
  expired:   'marketplace.voucher.expired',
  cancelled: 'marketplace.voucher.cancelled',
}

/** Green only while the voucher can still be handed to a cashier. */
export const isVoucherLive = (voucher: Voucher) => voucher.status === 'pending'

interface VoucherModalProps {
  open: boolean
  voucher: Voucher | null
  onClose: () => void
  onCancelVoucher: (voucher: Voucher) => void
  cancelling: boolean
}

export function VoucherModal({ open, voucher, onClose, onCancelVoucher, cancelling }: VoucherModalProps) {
  const { t, lang } = useTranslation()
  // Cancelling is irreversible, and the button sits under a QR the driver may be
  // holding out to a cashier — one stray tap must not throw the voucher away.
  const [confirming, setConfirming] = useState(false)
  if (!voucher) return null

  const close = () => {
    setConfirming(false)
    onClose()
  }

  return (
    <Modal open={open} onClose={close} title={t('marketplace.voucher.title')}>
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
          {/* The same code also sits on the reward card behind this modal; the id is
              what lets a test say which of the two it is looking at. */}
          <Text testID="voucher-modal-code" style={styles.qrCodeText}>{voucher.code}</Text>
        </View>

        <Text style={styles.voucherExpiry}>
          {t('marketplace.voucher.expiry')}: {expiryDate(voucher.expiresAt, lang)}
        </Text>
        <View style={[styles.statusBadge, { backgroundColor: isVoucherLive(voucher) ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)' }]}>
          <Text style={{ color: isVoucherLive(voucher) ? '#22c55e' : '#ef4444', fontWeight: '700' }}>
            {t(VOUCHER_STATUS_KEY[voucher.status])}
          </Text>
        </View>

        {voucher.status === 'pending' && (
          confirming ? (
            <View style={styles.cancelConfirm}>
              <Text style={styles.cancelPrompt}>{t('marketplace.voucher.cancelConfirm')}</Text>
              <View style={styles.cancelActions}>
                <Button size="sm" variant="secondary" onPress={() => setConfirming(false)} disabled={cancelling}>
                  {t('common.back')}
                </Button>
                <Button size="sm" variant="danger" onPress={() => onCancelVoucher(voucher)} disabled={cancelling}>
                  {cancelling ? '...' : t('common.confirm')}
                </Button>
              </View>
            </View>
          ) : (
            <TouchableOpacity onPress={() => setConfirming(true)}>
              <Text style={styles.cancelLink}>{t('marketplace.voucher.cancel')}</Text>
            </TouchableOpacity>
          )
        )}
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
  voucherStrip:     { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: COLORS.border, gap: 6 },
  voucherRow:       { flexDirection: 'row', alignItems: 'center', gap: 8 },
  voucherCode:      { color: COLORS.text, fontSize: 12, fontWeight: '700', fontFamily: 'monospace' },
  voucherExpiryInline: { color: COLORS.textMuted, fontSize: 11, flex: 1 },
  qrArrow:          { color: COLORS.brandLight, fontSize: 12, fontWeight: '700' },
  cancelLink:       { color: COLORS.danger, fontSize: 13, fontWeight: '600', paddingVertical: 6 },
  cancelConfirm:    { alignItems: 'center', gap: 10 },
  cancelPrompt:     { color: COLORS.textMuted, fontSize: 13, textAlign: 'center' },
  cancelActions:    { flexDirection: 'row', gap: 10 },
  voucherContent:   { alignItems: 'center', paddingVertical: 16, gap: 12 },
  voucherIconCircle: { width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(99,102,241,0.1)', alignItems: 'center', justifyContent: 'center' },
  voucherRewardTitle: { color: COLORS.text, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  qrPlaceholder:    { alignItems: 'center', justifyContent: 'center', padding: 12, gap: 8 },
  qrNote:           { color: COLORS.textMuted, fontSize: 11, marginTop: 2 },
  qrCodeText:       { color: COLORS.textMuted, fontSize: 10, fontFamily: 'monospace', letterSpacing: 1 },
  voucherExpiry:    { color: COLORS.textMuted, fontSize: 13 },
  statusBadge:      { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20 },
})
