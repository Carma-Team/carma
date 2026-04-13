'use client'

import React from 'react'
import { useT } from '@/hooks/useTranslation'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import type { Reward } from '@/types'

interface RewardCardProps {
  reward: Reward
  userPoints: number
  onRedeem: (reward: Reward) => void
}

export function RewardCard({ reward, userPoints, onRedeem }: RewardCardProps) {
  const { t, lang } = useT()
  const canAfford = userPoints >= reward.pointsCost
  const outOfStock = reward.stock <= 0

  return (
    <Card className={!canAfford ? 'opacity-75' : ''}>
      <div className="flex items-start gap-3">
        <div className="text-4xl flex-shrink-0 w-14 h-14 bg-white/5 rounded-xl flex items-center justify-center">
          {reward.imageEmoji}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-white font-bold text-sm leading-tight">
            {lang === 'he' ? reward.title : (reward.titleEn || reward.title)}
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">{reward.business}</p>
          <div className="flex items-center justify-between mt-3 gap-2">
            <Badge variant={canAfford ? 'level' : 'default'}>
              {reward.pointsCost} {t('marketplace.points')}
            </Badge>
            <Button
              size="sm"
              variant={canAfford && !outOfStock ? 'primary' : 'secondary'}
              disabled={!canAfford || outOfStock}
              onClick={() => onRedeem(reward)}
            >
              {outOfStock ? t('marketplace.outOfStock') : t('marketplace.redeem')}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  )
}

export default RewardCard
