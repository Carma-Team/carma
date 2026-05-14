import React, { useEffect, useState } from 'react'
import { View, ScrollView, ActivityIndicator } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { RewardCard, VoucherModal } from '@/components/marketplace/RewardCard'
import { CategoryFilter } from '@/components/marketplace/CategoryFilter'
import { RedeemConfirmSheet } from '@/components/marketplace/RedeemConfirmSheet'
import { MarketplaceHeader } from '@/components/marketplace/MarketplaceHeader'
import { MarketplaceTabs } from '@/components/marketplace/MarketplaceTabs'
import { VoucherList } from '@/components/marketplace/VoucherList'
import { useApp } from '@/context/AppContext'
import { useTranslation } from '@/hooks/useTranslation'
import { rewardsApi } from '@/services/api/rewards.api'
import { REWARD_CATEGORIES } from '@/lib/constants'
import { COLORS, COMMON_STYLES } from '@/constants/theme'
import type { Reward, Voucher } from '@/types'

type Tab = 'rewards' | 'vouchers'

/**
 * מסך חנות ההטבות.
 * מציג רשימת הטבות לפדיון ורשימת שוברים שהמשתמש כבר פדה.
 * ניתן לסנן הטבות לפי קטגוריה.
 */
export default function MarketplaceScreen() {
  const insets = useSafeAreaInsets()
  const { user, setUser, addToast } = useApp()
  const { t, lang } = useTranslation()

  const [tab, setTab] = useState<Tab>('rewards')
  const [category, setCategory] = useState('all')
  const [rewards, setRewards] = useState<Reward[]>([])
  const [vouchers, setVouchers] = useState<Voucher[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedReward, setSelectedReward] = useState<Reward | null>(null)
  const [selectedVoucher, setSelectedVoucher] = useState<Voucher | null>(null)
  const [redeeming, setRedeeming] = useState(false)

  const categories = [{ key: 'all', labelHe: 'הכל', labelEn: 'All', emoji: '🏪' }, ...REWARD_CATEGORIES]

  /**
   * טוען הטבות ושוברים מהשרת בכל שינוי קטגוריה.
   *
   * [שרת] rewardsApi.list(category) → GET /api/rewards?category=...
   *   - USE_REAL_SERVER=false → מיורט ב-client.ts, מחזיר MOCK_REWARDS + MOCK_VOUCHERS
   *   - USE_REAL_SERVER=true  → GET /api/rewards לשרת האמיתי של נווה
   */
  useEffect(() => {
    setLoading(true)
    rewardsApi.list(category)
      .then(data => {
        setRewards(data.rewards)
        setVouchers(data.vouchers)
      })
      .finally(() => setLoading(false))
  }, [category])

  /**
   * מבצעת פדיון הטבה: מורידה נקודות מהמשתמש ויוצרת שובר.
   * נקראת רק לאחר אישור המשתמש ב-RedeemConfirmSheet.
   *
   * [שרת] rewardsApi.redeem(id) → POST /api/rewards/:id/redeem
   *   - USE_REAL_SERVER=false → מיורט ב-client.ts, מחזיר mock voucher
   *   - USE_REAL_SERVER=true  → POST לשרת האמיתי של נווה
   *
   * לאחר הצלחה: מוסיפה את השובר לרשימה, מעדכנת נקודות ב-AppContext,
   * מציגה toast הצלחה ועוברת לטאב השוברים.
   */
  async function confirmRedeem() {
    if (!selectedReward || !user) return
    setRedeeming(true)
    try {
      const data = await rewardsApi.redeem(selectedReward.id)
      setVouchers(prev => [data.voucher, ...prev])
      await setUser({ ...user, points: (user.points || 0) - selectedReward.costPoints })
      addToast({ type: 'success', message: t('marketplace.redeemSuccess') })
      setSelectedReward(null)
      setTab('vouchers')
    } catch {
      addToast({ type: 'error', message: t('common.error') })
    } finally {
      setRedeeming(false)
    }
  }

  if (!user) return null

  return (
    <View style={[COMMON_STYLES.screen, { paddingTop: Math.max(insets.top, 20) }]}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={COMMON_STYLES.scrollContent}>

        {/* Header Section */}
        <MarketplaceHeader points={user.points || 0} />

        {/* Navigation Tabs */}
        <MarketplaceTabs
          activeTab={tab}
          onTabChange={setTab}
          vouchersCount={vouchers.length}
        />

        {tab === 'rewards' && (
          <>
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
                {rewards
                  .filter(r => category === 'all' || r.category === category)
                  .map(r => (
                    <RewardCard
                      key={r.id}
                      reward={r}
                      userPoints={user.points || 0}
                      onRedeem={setSelectedReward}
                    />
                  ))
                }
              </View>
            )}
          </>
        )}

        {tab === 'vouchers' && (
          <VoucherList
            vouchers={vouchers}
            onVoucherPress={setSelectedVoucher}
            lang={lang}
          />
        )}
      </ScrollView>

      {/* Overlays & Modals */}
      {selectedReward && (
        <RedeemConfirmSheet
          reward={selectedReward}
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
      />
    </View>
  )
}
