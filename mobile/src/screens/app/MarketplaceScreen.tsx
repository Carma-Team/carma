import React, { useCallback, useEffect, useRef, useState } from 'react'
import { View, ScrollView, ActivityIndicator } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { RewardCard, VoucherModal } from '@/components/marketplace/RewardCard'
import { CategoryFilter } from '@/components/marketplace/CategoryFilter'
import { RedeemConfirmSheet } from '@/components/marketplace/RedeemConfirmSheet'
import { MarketplaceHeader } from '@/components/marketplace/MarketplaceHeader'
import { useApp } from '@/context/AppContext'
import { useTranslation } from '@/hooks/useTranslation'
import { rewardsApi } from '@/services/api/rewards.api'
import { ApiError } from '@/services/api/client'
import { sortByAvailability } from '@/lib/rewardStock'
import { availableBalance } from '@/lib/utils'
import { COLORS, COMMON_STYLES } from '@/constants/theme'
import { REWARD_CATEGORIES, type IoniconName } from '@/constants/icons'
import type { Reward, Voucher } from '@/types'

// The redemption codes the server sends inside a 409 detail. Branching on the code
// and not on the message is the server's own contract — the message is English prose.
const REDEEM_ERROR_KEYS: Record<string, string> = {
  REWARD_OUT_OF_STOCK: 'marketplace.redeemOutOfStock',
  REWARD_CAMPAIGN_ENDED: 'marketplace.redeemCampaignEnded',
}

/**
 * Rewards store screen.
 * Shows a list of redeemable rewards, each card carrying the live vouchers already
 * issued against it. Rewards can be filtered by category.
 */
export default function MarketplaceScreen() {
  const insets = useSafeAreaInsets()
  const { user, patchUser, addToast } = useApp()
  const { t, lang } = useTranslation()

  const [category, setCategory] = useState('all')
  const [rewards, setRewards] = useState<Reward[]>([])
  const [vouchers, setVouchers] = useState<Voucher[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedReward, setSelectedReward] = useState<Reward | null>(null)
  const [selectedVoucher, setSelectedVoucher] = useState<Voucher | null>(null)
  const [redeeming, setRedeeming] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  const categories = [
    // Bilingual data-record pattern (labelHe/labelEn), same as REWARD_CATEGORIES below — not a hardcoded-copy violation. See docs/i18n.md.
    // eslint-disable-next-line no-restricted-syntax
    { key: 'all', labelHe: 'הכל', labelEn: 'All', icon: 'grid-outline' as IoniconName },
    ...REWARD_CATEGORIES.map(c => ({ ...c, icon: c.icon as IoniconName })),
  ]

  // Which load is the current one. Two things call loadCatalog — the category
  // effect and the 409 refresh — so a slow earlier response can land after a
  // newer one and repaint the screen with the wrong category's rewards.
  const latestLoad = useRef(0)

  /**
   * Loads rewards and vouchers from the server on every category change.
   *
   * [server] rewardsApi.list(category) → GET /api/rewards?category=...
   *   - USE_REAL_SERVER=false → intercepted in client.ts, returns MOCK_REWARDS + MOCK_VOUCHERS
   *   - USE_REAL_SERVER=true  → GET /api/rewards on the real server
   */
  const loadCatalog = useCallback(() => {
    const load = ++latestLoad.current
    setLoading(true)
    return rewardsApi.list(category)
      .then(data => {
        if (load !== latestLoad.current) return
        setRewards(data.rewards)
        setVouchers(data.vouchers)
      })
      .catch(() => {
        // Without this the screen sits on an empty list with no explanation —
        // and the 409 refresh below would reject inside a catch block.
        if (load === latestLoad.current) addToast({ type: 'error', message: t('common.error') })
      })
      .finally(() => {
        if (load === latestLoad.current) setLoading(false)
      })
  }, [category, addToast, t])

  useEffect(() => { loadCatalog() }, [loadCatalog])

  /**
   * Redeems a reward: reserves the user's points and creates a voucher.
   * Called only after the user confirms in RedeemConfirmSheet.
   *
   * [server] rewardsApi.redeem(id) → POST /api/rewards/:id/redeem
   *   - USE_REAL_SERVER=false → intercepted in client.ts, returns mock voucher
   *   - USE_REAL_SERVER=true  → POST to the real server
   *
   * On success: adds the voucher to the list, updates points in AppContext and
   * shows a success toast. The new voucher appears on the reward's own card.
   */
  async function confirmRedeem() {
    if (!selectedReward || !user) return
    setRedeeming(true)
    try {
      const data = await rewardsApi.redeem(selectedReward.id)
      setVouchers(prev => [data.voucher, ...prev])
      // Issuing a voucher no longer spends the points, it holds them (CAR-73).
      // The total stays put; only the split between available and reserved moves.
      patchUser(prev => ({
        availablePoints: availableBalance(prev) - selectedReward.costPoints,
        reservedPoints: (prev.reservedPoints || 0) + selectedReward.costPoints,
      }))
      addToast({ type: 'success', message: t('marketplace.redeemSuccess') })
      setSelectedReward(null)
    } catch (e) {
      const key = e instanceof ApiError ? REDEEM_ERROR_KEYS[e.code ?? ''] : undefined
      addToast({ type: 'error', message: t(key ?? 'common.error') })
      // A 409 means the catalog moved on while the sheet was open: the card was drawn
      // from a stock count that is no longer true. Close it and re-read, so a second
      // attempt is not on offer — sold out comes back disabled, and an ended campaign
      // does not come back at all (`list_rewards` filters on expires_at).
      if (e instanceof ApiError && e.status === 409) {
        setSelectedReward(null)
        loadCatalog()
      }
    } finally {
      setRedeeming(false)
    }
  }

  /**
   * Cancels a voucher the driver no longer wants.
   *
   * [server] rewardsApi.cancel(id) → POST /api/vouchers/:id/cancel
   */
  async function cancelVoucher(voucher: Voucher) {
    if (!user) return
    setCancelling(true)
    try {
      await rewardsApi.cancel(voucher.id)
      setVouchers(prev => prev.filter(v => v.id !== voucher.id))
      // Mirror of the redemption: the points the voucher held go back to spendable.
      patchUser(prev => ({
        availablePoints: availableBalance(prev) + voucher.pointsCost,
        reservedPoints: Math.max(0, (prev.reservedPoints || 0) - voucher.pointsCost),
      }))
      setSelectedVoucher(null)
      addToast({ type: 'success', message: t('marketplace.voucher.cancelSuccess') })
    } catch {
      addToast({ type: 'error', message: t('common.error') })
    } finally {
      setCancelling(false)
    }
  }

  if (!user) return null

  const available = availableBalance(user)

  // Only a pending voucher is live. Used, expired and cancelled ones are history:
  // they hold no points and the card has no room for them.
  const liveVouchers = vouchers.reduce<Record<string, Voucher[]>>((acc, v) => {
    if (v.status === 'pending') (acc[v.rewardId] ??= []).push(v)
    return acc
  }, {})

  return (
    <View style={[COMMON_STYLES.screen, { paddingTop: Math.max(insets.top, 20) }]}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={COMMON_STYLES.scrollContent}>

        {/* Header Section */}
        <MarketplaceHeader available={available} reserved={user.reservedPoints || 0} />

        <CategoryFilter
          categories={categories}
          selectedCategory={category}
          onSelectCategory={setCategory}
          lang={lang}
        />

        {loading ? (
          <ActivityIndicator color={COLORS.brand} style={{ marginTop: 24 }} />
        ) : (
          <View style={{ gap: 10 }}>
            {sortByAvailability(
              rewards.filter(r => category === 'all' || r.category === category)
            )
              .map(r => (
                <RewardCard
                  key={r.id}
                  reward={r}
                  userPoints={available}
                  vouchers={liveVouchers[r.id] ?? []}
                  onRedeem={setSelectedReward}
                  onVoucherPress={setSelectedVoucher}
                />
              ))
            }
          </View>
        )}
      </ScrollView>

      {/* Overlays & Modals */}
      {selectedReward && (
        <RedeemConfirmSheet
          reward={selectedReward}
          availableAfter={available - selectedReward.costPoints}
          onConfirm={confirmRedeem}
          onCancel={() => setSelectedReward(null)}
          loading={redeeming}
          lang={lang}
        />
      )}

      <VoucherModal
        open={!!selectedVoucher}
        voucher={selectedVoucher}
        onClose={() => setSelectedVoucher(null)}
        onCancelVoucher={cancelVoucher}
        cancelling={cancelling}
      />
    </View>
  )
}
