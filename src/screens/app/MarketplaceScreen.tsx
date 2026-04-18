import React, { useEffect, useState } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { Card } from '@/components/ui/Card'
import { RewardCard, VoucherModal } from '@/components/marketplace/RewardCard'
import { useApp } from '@/context/AppContext'
import { useTranslation } from '@/hooks/useTranslation'
import { rewardsApi } from '@/lib/api'
import { REWARD_CATEGORIES, COLORS } from '@/lib/constants'
import type { Reward, Voucher } from '@/navigation/types'

type Tab = 'rewards' | 'vouchers'

export default function MarketplaceScreen() {
  const { user, setUser, addToast } = useApp()
  const { t, lang } = useTranslation()
  const [tab,            setTab]            = useState<Tab>('rewards')
  const [category,       setCategory]       = useState('all')
  const [rewards,        setRewards]        = useState<Reward[]>([])
  const [vouchers,       setVouchers]       = useState<Voucher[]>([])
  const [loading,        setLoading]        = useState(true)
  const [selectedReward, setSelectedReward] = useState<Reward | null>(null)
  const [selectedVoucher,setSelectedVoucher]= useState<Voucher | null>(null)
  const [redeeming,      setRedeeming]      = useState(false)

  useEffect(() => {
    setLoading(true)
    rewardsApi.list(category)
      .then(data => { setRewards(data.rewards); setVouchers(data.vouchers) })
      .finally(() => setLoading(false))
  }, [category])

  async function confirmRedeem() {
    if (!selectedReward || !user) return
    setRedeeming(true)
    try {
      const data = await rewardsApi.redeem(selectedReward.id)
      setVouchers(prev => [data.voucher, ...prev])
      await setUser({ ...user, totalPoints: user.totalPoints - selectedReward.pointsCost })
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
  const categories = [{ key: 'all', labelHe: 'הכל', labelEn: 'All', emoji: '🏪' }, ...REWARD_CATEGORIES]

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>{t('marketplace.title')}</Text>
      <Text style={styles.subtitle}>{t('marketplace.subtitle')}</Text>

      <Card glass style={styles.pointsCard}>
        <Text style={styles.pointsValue}>{user.totalPoints.toLocaleString()}</Text>
        <Text style={styles.pointsLabel}>{t('common.points')}</Text>
      </Card>

      {/* Tabs */}
      <View style={styles.tabs}>
        {(['rewards', 'vouchers'] as Tab[]).map(t2 => (
          <TouchableOpacity key={t2} onPress={() => setTab(t2)} style={[styles.tab, tab === t2 && styles.tabActive]}>
            <Text style={[styles.tabText, tab === t2 && styles.tabTextActive]}>
              {t2 === 'rewards' ? t('marketplace.allRewards') : `${t('marketplace.myVouchers')} (${vouchers.length})`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'rewards' && (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categories} contentContainerStyle={{ gap: 8 }}>
            {categories.map(cat => (
              <TouchableOpacity key={cat.key} onPress={() => setCategory(cat.key)} style={[styles.catBtn, category === cat.key && styles.catBtnActive]}>
                <Text style={[styles.catText, category === cat.key && styles.catTextActive]}>
                  {cat.emoji} {lang === 'he' ? cat.labelHe : cat.labelEn}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {loading
            ? <ActivityIndicator color={COLORS.brand} style={{ marginTop: 24 }} />
            : <View style={{ gap: 10 }}>
                {rewards.map(r => <RewardCard key={r.id} reward={r} userPoints={user.totalPoints} onRedeem={setSelectedReward} />)}
              </View>
          }
        </>
      )}

      {tab === 'vouchers' && (
        <View style={{ gap: 10 }}>
          {vouchers.length === 0
            ? <Card style={styles.empty}><Text style={styles.emptyIcon}>🎁</Text><Text style={styles.emptyText}>{t('marketplace.myVouchers')}</Text></Card>
            : vouchers.map(v => (
                <TouchableOpacity key={v.id} onPress={() => setSelectedVoucher(v)}>
                  <Card>
                    <View style={styles.voucherRow}>
                      <Text style={{ fontSize: 28 }}>{v.reward?.imageEmoji ?? '🎁'}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.voucherTitle}>{lang === 'he' ? v.reward?.title : (v.reward?.titleEn || v.reward?.title)}</Text>
                        <Text style={styles.voucherCode}>{v.code}</Text>
                      </View>
                      <Text style={styles.qrArrow}>QR →</Text>
                    </View>
                  </Card>
                </TouchableOpacity>
              ))
          }
        </View>
      )}

      {/* Redeem confirm modal */}
      {selectedReward && (
        <View style={StyleSheet.absoluteFillObject}>
          <TouchableOpacity style={styles.overlay} onPress={() => setSelectedReward(null)} activeOpacity={1} />
          <View style={styles.confirmSheet}>
            <Text style={styles.confirmEmoji}>{selectedReward.imageEmoji}</Text>
            <Text style={styles.confirmTitle}>{lang === 'he' ? selectedReward.title : selectedReward.titleEn || selectedReward.title}</Text>
            <Text style={styles.confirmCost}>⭐ {selectedReward.pointsCost} {t('common.points')}</Text>
            <TouchableOpacity style={styles.confirmBtn} onPress={confirmRedeem} disabled={redeeming}>
              <Text style={styles.confirmBtnText}>{redeeming ? '...' : t('marketplace.redeem')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <VoucherModal open={!!selectedVoucher} voucher={selectedVoucher} onClose={() => setSelectedVoucher(null)} />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  root:           { flex: 1, backgroundColor: COLORS.dark },
  content:        { padding: 16, paddingBottom: 100 },
  heading:        { color: '#fff', fontSize: 24, fontWeight: '900' },
  subtitle:       { color: COLORS.textMuted, fontSize: 13, marginBottom: 12 },
  pointsCard:     { alignItems: 'center', paddingVertical: 12, marginBottom: 12 },
  pointsValue:    { color: COLORS.brandLight, fontSize: 32, fontWeight: '900' },
  pointsLabel:    { color: COLORS.textMuted, fontSize: 12 },
  tabs:           { flexDirection: 'row', backgroundColor: COLORS.card, borderRadius: 12, padding: 4, marginBottom: 12, borderWidth: 1, borderColor: COLORS.border },
  tab:            { flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: 'center' },
  tabActive:      { backgroundColor: COLORS.brand },
  tabText:        { color: COLORS.textMuted, fontSize: 13, fontWeight: '600' },
  tabTextActive:  { color: '#fff' },
  categories:     { marginBottom: 12 },
  catBtn:         { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border },
  catBtnActive:   { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  catText:        { color: COLORS.textMuted, fontSize: 12, fontWeight: '600' },
  catTextActive:  { color: '#fff' },
  empty:          { alignItems: 'center', paddingVertical: 40 },
  emptyIcon:      { fontSize: 40, marginBottom: 8 },
  emptyText:      { color: COLORS.textMuted },
  voucherRow:     { flexDirection: 'row', alignItems: 'center', gap: 12 },
  voucherTitle:   { color: '#fff', fontWeight: '600', fontSize: 14 },
  voucherCode:    { color: COLORS.textMuted, fontSize: 12 },
  qrArrow:        { color: COLORS.brandLight, fontSize: 13 },
  overlay:        { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.7)' },
  confirmSheet:   { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: COLORS.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, alignItems: 'center', gap: 8 },
  confirmEmoji:   { fontSize: 48 },
  confirmTitle:   { color: '#fff', fontSize: 18, fontWeight: '700' },
  confirmCost:    { color: COLORS.brandLight, fontSize: 15 },
  confirmBtn:     { backgroundColor: COLORS.brand, borderRadius: 12, paddingHorizontal: 32, paddingVertical: 14, marginTop: 8 },
  confirmBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
})
