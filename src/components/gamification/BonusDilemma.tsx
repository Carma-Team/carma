'use client'

import React from 'react'
import { useT } from '@/hooks/useTranslation'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import type { Reward } from '@/types'

interface BonusDilemmaProps {
  open: boolean
  reward: Reward | null
  onRedeem: () => void
  onInvest: () => void
  onClose: () => void
  loading?: boolean
}

export function BonusDilemma({ open, reward, onRedeem, onInvest, onClose, loading }: BonusDilemmaProps) {
  const { t, lang } = useT()
  if (!reward) return null

  return (
    <Modal open={open} onClose={onClose} title={t('marketplace.bonusDilemma.title')}>
      <div className="space-y-4">
        <div className="text-center py-2">
          <div className="text-5xl mb-3">{reward.imageEmoji}</div>
          <h3 className="text-white font-bold">{lang === 'he' ? reward.title : (reward.titleEn || reward.title)}</h3>
          <p className="text-sm text-slate-400">{reward.business}</p>
          <p className="text-brand-400 font-bold mt-1">{reward.pointsCost} {t('common.points')}</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={onRedeem}
            disabled={loading}
            className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-brand-500/40 bg-brand-500/10 hover:bg-brand-500/20 transition-colors text-center"
          >
            <span className="text-3xl">🎁</span>
            <span className="font-bold text-white text-sm">{t('marketplace.bonusDilemma.redeem')}</span>
            <span className="text-xs text-slate-400">{t('marketplace.bonusDilemma.redeemDesc')}</span>
          </button>

          <button
            onClick={onInvest}
            disabled={loading}
            className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-slate-600 bg-slate-800 hover:bg-slate-700 transition-colors text-center"
          >
            <span className="text-3xl">💰</span>
            <span className="font-bold text-white text-sm">{t('marketplace.bonusDilemma.invest')}</span>
            <span className="text-xs text-slate-400">{t('marketplace.bonusDilemma.investDesc')}</span>
          </button>
        </div>

        <Button variant="ghost" fullWidth onClick={onClose} size="sm">
          {t('marketplace.bonusDilemma.cancel')}
        </Button>
      </div>
    </Modal>
  )
}

export default BonusDilemma
