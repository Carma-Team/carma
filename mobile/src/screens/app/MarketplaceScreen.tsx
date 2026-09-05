import React, { useCallback, useEffect, useRef, useState } from 'react'
import { View, ScrollView, ActivityIndicator, Text, TouchableOpacity } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { RewardCard, VoucherModal } from '@/components/marketplace/RewardCard'
import { CategoryFilter } from '@/components/marketplace/CategoryFilter'
import { VoucherList } from '@/components/marketplace/VoucherList'
import { RedeemConfirmSheet } from '@/components/marketplace/RedeemConfirmSheet'
import { MarketplaceHeader } from '@/components/marketplace/MarketplaceHeader'
import { Button } from '@/components/ui/Button'
import { useApp } from '@/context/AppContext'
import { useTranslation } from '@/hooks/useTranslation'
import { rewardsApi } from '@/services/api/rewards.api'
import { ApiError } from '@/services/api/client'
import { sortByAvailability } from '@/lib/rewardStock'
import { availableBalance, formatDuration } from '@/lib/utils'
import { COLORS, COMMON_STYLES } from '@/constants/theme'
import { REWARD_CATEGORIES, type IoniconName } from '@/constants/icons'
import type { Reward, Voucher } from '@/types'

// The redemption codes the server sends inside a 409 detail. Branching on the code
// and not on the message is the server's own contract — the message is English prose.
// `withWait` is the phrasing for when the server also said how long — a separate
// string and not an appended one, so the translator places the duration inside the
// sentence. Only these two codes ever carry a wait, and even they can arrive without.
const REDEEM_ERRORS: Record<string, { plain: string; withWait?: string }> = {
  REWARD_OUT_OF_STOCK:      { plain: 'marketplace.redeemOutOfStock' },
  REWARD_CAMPAIGN_ENDED:    { plain: 'marketplace.redeemCampaignEnded' },
  VOUCHER_REISSUE_COOLDOWN: { plain: 'marketplace.redeemCooldown', withWait: 'marketplace.redeemCooldownWait' },
  VOUCHER_LIMIT_REACHED:    { plain: 'marketplace.redeemAtCap',    withWait: 'marketplace.redeemAtCapWait' },
}

// How many reward cards render before the driver asks for more, and how many each
// press adds. Smaller than the dashboard's 5-trip batch is not the goal — a reward
// card is roughly twice the height of a trip row, so 6 fills about the same screen.
const BATCH_SIZE = 6

/**
 * Rewards store screen.
 * Shows a list of redeemable rewards, each card carrying the live vouchers already
 * issued against it. Rewards can be filtered by category.
 */
export default function MarketplaceScreen() {
  const insets = useSafeAreaInsets()
  const { user, patchUser, addToast } = useApp()
  const { t, lang } = useTranslation()

  const [view, setView] = useState<'store' | 'vouchers'>('store')
  const [category, setCategory] = useState('all')
  const [visibleCount, setVisibleCount] = useState(BATCH_SIZE)
  const [rewards, setRewards] = useState<Reward[]>([])
  const [vouchers, setVouchers] = useState<Voucher[]>([])
  const [myVouchers, setMyVouchers] = useState<Voucher[]>([])
  const [loadingVouchers, setLoadingVouchers] = useState(false)
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
        if (load === latestLoad.current) addToast({ type: 'error', message: t('marketplace.loadFailed') })
      })
      .finally(() => {
        if (load === latestLoad.current) setLoading(false)
      })
  }, [category, addToast, t])

  useEffect(() => { loadCatalog() }, [loadCatalog])

  /**
   * Loads every voucher the driver owns, in any state.
   *
   * [server] rewardsApi.myVouchers() → GET /api/vouchers
   *
   * Deliberately not folded into loadCatalog: the catalog reloads on every category
   * change, and this list does not depend on the category at all. The catalog's own
   * voucher side-car carries only the live ones, which is why it cannot serve here.
   */
  useEffect(() => {
    if (view !== 'vouchers') return
    let live = true
    setLoadingVouchers(true)
    rewardsApi.myVouchers()
      .then(data => { if (live) setMyVouchers(data.vouchers) })
      .catch(() => { if (live) addToast({ type: 'error', message: t('marketplace.loadFailed') }) })
      .finally(() => { if (live) setLoadingVouchers(false) })
    return () => { live = false }
  }, [view, addToast, t])

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
  /**
   * Which of two things went wrong, in the driver's terms: the server answered and
   * refused, or it was never reached at all. One means the action was considered and
   * declined, the other that it did not happen — and both say what is true of the
   * voucher and the points now, since neither leaves them half-moved.
   */
  function failureMessage(e: unknown, refusedKey: string, unreachableKey: string): string {
    return t(e instanceof ApiError ? refusedKey : unreachableKey)
  }

  /**
   * Toast text for a refused redemption. The named reasons win; two of them come with
   * the wait the server itself computed, and the app never derives a duration of its
   * own or says anything about timing when the server sent none.
   */
  function redeemErrorMessage(e: unknown): string {
    const reason = e instanceof ApiError ? REDEEM_ERRORS[e.code ?? ''] : undefined
    if (!reason || !(e instanceof ApiError)) {
      return failureMessage(e, 'marketplace.redeemRefused', 'marketplace.redeemUnreachable')
    }
    return reason.withWait && e.retryAfterSeconds
      ? t(reason.withWait).replace('{wait}', formatDuration(e.retryAfterSeconds, lang))
      : t(reason.plain)
  }

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
      // Straight into the voucher: the code and the QR are the whole point of having
      // redeemed, and leaving it closed asks the driver to go find what they just bought.
      setSelectedVoucher(data.voucher)
    } catch (e) {
      addToast({ type: 'error', message: redeemErrorMessage(e) })
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
      // The owned list keeps it and restates it as cancelled, rather than dropping it
      // the way the card's live strip does — a driver looking at their own vouchers
      // should see the one that just went away, not a list that silently shrank.
      setMyVouchers(prev => prev.map(v => (v.id === voucher.id ? { ...v, status: 'cancelled' } : v)))
      // Mirror of the redemption: the points the voucher held go back to spendable.
      patchUser(prev => ({
        availablePoints: availableBalance(prev) + voucher.pointsCost,
        reservedPoints: Math.max(0, (prev.reservedPoints || 0) - voucher.pointsCost),
      }))
      setSelectedVoucher(null)
      addToast({ type: 'success', message: t('marketplace.voucher.cancelSuccess') })
    } catch (e) {
      addToast({
        type: 'error',
        message: failureMessage(e, 'marketplace.voucher.cancelRefused', 'marketplace.voucher.cancelUnreachable'),
      })
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

  const catalog = sortByAvailability(
    rewards.filter(r => category === 'all' || r.category === category)
  )
  const visibleRewards = catalog.slice(0, visibleCount)

  return (
    <View style={[COMMON_STYLES.screen, { paddingTop: Math.max(insets.top, 20) }]}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={COMMON_STYLES.scrollContent}>

        {/* Header Section */}
        <MarketplaceHeader available={available} reserved={user.reservedPoints || 0} />

        {/* What is on sale versus what this driver already owns. Kept out of the
            category row on purpose: a category classifies the reward, not the
            ownership, and one row doing both is harder to read than two. */}
        {/* The reward list sat straight against the tabs. 16 matches the gap the
            leaderboard leaves under its own tab row. */}
        <View style={[COMMON_STYLES.tabsContainer, { marginBottom: 16 }]}>
          {([['store', 'marketplace.tabStore'], ['vouchers', 'marketplace.tabMyVouchers']] as const).map(([key, labelKey]) => (
            <TouchableOpacity
              key={key}
              onPress={() => setView(key)}
              style={[COMMON_STYLES.tab, view === key && COMMON_STYLES.tabActive]}
            >
              <Text style={[COMMON_STYLES.tabText, view === key && COMMON_STYLES.tabTextActive]}>
                {t(labelKey)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {view === 'vouchers' ? (
          loadingVouchers ? (
            <ActivityIndicator color={COLORS.brand} style={{ marginTop: 24 }} />
          ) : (
            <VoucherList vouchers={myVouchers} onVoucherPress={setSelectedVoucher} />
          )
        ) : (
        <>
        <CategoryFilter
          categories={categories}
          selectedCategory={category}
          onSelectCategory={key => {
            // A new category is a new list; carrying the old page depth over would
            // open it already scrolled past its first screen of rewards.
            setCategory(key)
            setVisibleCount(BATCH_SIZE)
          }}
          lang={lang}
        />

        {loading ? (
          <ActivityIndicator color={COLORS.brand} style={{ marginTop: 24 }} />
        ) : (
          <View style={{ gap: 10 }}>
            {visibleRewards.map(r => (
              <RewardCard
                key={r.id}
                reward={r}
                userPoints={available}
                vouchers={liveVouchers[r.id] ?? []}
                onRedeem={setSelectedReward}
                onVoucherPress={setSelectedVoucher}
              />
            ))}
            {/* The whole catalog is already in memory from loadCatalog, so this only
                grows how many cards render. Slicing a prefix keeps the cards already
                on screen in place instead of reshuffling them. */}
            {catalog.length > visibleCount && (
              <Button
                variant="ghost"
                size="md"
                fullWidth
                onPress={() => setVisibleCount(count => count + BATCH_SIZE)}
              >
                {t('dashboard.showMore')}
              </Button>
            )}
          </View>
        )}
        </>
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
