'use client'

import React, { useEffect, useState } from 'react'
import { useApp } from '@/context/AppContext'
import { useT } from '@/hooks/useTranslation'
import { RewardCard } from '@/components/marketplace/RewardCard'
import { VoucherModal } from '@/components/marketplace/VoucherModal'
import { BonusDilemma } from '@/components/gamification/BonusDilemma'
import { Card } from '@/components/ui/Card'
import { REWARD_CATEGORIES } from '@/lib/constants'
import type { Reward, Voucher } from '@/types'

type Tab = 'rewards' | 'vouchers'

export default function MarketplacePage() {
  const { user, setUser, addToast } = useApp()
  const { t, lang } = useT()
  const [tab, setTab] = useState<Tab>('rewards')
  const [category, setCategory] = useState('all')
  const [rewards, setRewards] = useState<Reward[]>([])
  const [vouchers, setVouchers] = useState<Voucher[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedReward, setSelectedReward] = useState<Reward | null>(null)
  const [selectedVoucher, setSelectedVoucher] = useState<Voucher | null>(null)
  const [redeeming, setRedeeming] = useState(false)

  useEffect(() => {
    fetch(`/api/rewards${category !== 'all' ? `?category=${category}` : ''}`)
      .then(res => res.json())
      .then(data => {
        setRewards(data.rewards)
        setVouchers(data.vouchers)
      })
      .finally(() => setLoading(false))
  }, [category])

  async function handleRedeem(reward: Reward) {
    setSelectedReward(reward)
  }

  async function confirmRedeem() {
    if (!selectedReward || !user) return
    setRedeeming(true)
    try {
      const res = await fetch(`/api/rewards/${selectedReward.id}/redeem`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        addToast({ type: 'error', message: data.error || t('common.error') })
        return
      }
      setVouchers(prev => [data.voucher, ...prev])
      setUser({ ...user, totalPoints: user.totalPoints - selectedReward.pointsCost })
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
    <div className="pt-6 pb-4 page-enter">
      <div className="mb-4">
        <h1 className="text-2xl font-black text-white">{t('marketplace.title')}</h1>
        <p className="text-slate-400 text-sm mt-0.5">{t('marketplace.subtitle')}</p>
      </div>

      {/* Points display */}
      <Card glass className="mb-4 text-center py-3">
        <p className="text-3xl font-black text-brand-400">{user.totalPoints.toLocaleString()}</p>
        <p className="text-xs text-slate-400">{t('common.points')}</p>
      </Card>

      {/* Tabs */}
      <div className="flex bg-carma-card border border-carma-border rounded-xl p-1 gap-1 mb-4">
        {(['rewards', 'vouchers'] as Tab[]).map(t2 => (
          <button
            key={t2}
            onClick={() => setTab(t2)}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
              tab === t2 ? 'bg-brand-500 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            {t2 === 'rewards' ? t('marketplace.allRewards') : `${t('marketplace.myVouchers')} (${vouchers.length})`}
          </button>
        ))}
      </div>

      {tab === 'rewards' && (
        <>
          {/* Category filter */}
          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1 mb-4">
            {categories.map(cat => (
              <button
                key={cat.key}
                onClick={() => setCategory(cat.key)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                  category === cat.key
                    ? 'bg-brand-500 text-white'
                    : 'bg-carma-card border border-carma-border text-slate-400 hover:text-white'
                }`}
              >
                {cat.emoji} {lang === 'he' ? cat.labelHe : cat.labelEn}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-24 bg-carma-card rounded-2xl border border-carma-border animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {rewards.map(reward => (
                <RewardCard key={reward.id} reward={reward} userPoints={user.totalPoints} onRedeem={handleRedeem} />
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'vouchers' && (
        <div className="space-y-3">
          {vouchers.length === 0 ? (
            <Card className="text-center py-10">
              <div className="text-4xl mb-2">🎁</div>
              <p className="text-slate-400">{t('marketplace.myVouchers')}</p>
              <p className="text-slate-500 text-sm mt-1">אין שוברים עדיין</p>
            </Card>
          ) : (
            vouchers.map(voucher => (
              <Card
                key={voucher.id}
                className="cursor-pointer hover:border-brand-500/40 transition-colors"
                onClick={() => setSelectedVoucher(voucher)}
              >
                <div className="flex items-center gap-3">
                  <div className="text-3xl">{voucher.reward?.imageEmoji ?? '🎁'}</div>
                  <div className="flex-1">
                    <p className="text-white font-semibold text-sm">
                      {lang === 'he' ? voucher.reward?.title : (voucher.reward?.titleEn || voucher.reward?.title)}
                    </p>
                    <p className="text-slate-400 text-xs">{voucher.code}</p>
                  </div>
                  <div className="text-xs text-brand-400">QR →</div>
                </div>
              </Card>
            ))
          )}
        </div>
      )}

      <BonusDilemma
        open={!!selectedReward}
        reward={selectedReward}
        onRedeem={confirmRedeem}
        onInvest={() => setSelectedReward(null)}
        onClose={() => setSelectedReward(null)}
        loading={redeeming}
      />

      <VoucherModal
        open={!!selectedVoucher}
        voucher={selectedVoucher}
        onClose={() => setSelectedVoucher(null)}
      />
    </div>
  )
}
