'use client'

import React from 'react'
import { useT } from '@/hooks/useTranslation'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { formatDate } from '@/lib/utils'
import type { Voucher } from '@/types'

interface VoucherModalProps {
  open: boolean
  voucher: Voucher | null
  onClose: () => void
}

export function VoucherModal({ open, voucher, onClose }: VoucherModalProps) {
  const { t, lang } = useT()
  if (!voucher) return null

  const isExpired = new Date(voucher.expiresAt) < new Date()
  const reward = voucher.reward

  return (
    <Modal open={open} onClose={onClose} title={t('marketplace.voucher.title')}>
      <div className="space-y-4 text-center">
        {reward && (
          <>
            <div className="text-5xl">{reward.imageEmoji}</div>
            <div>
              <h3 className="text-white font-bold text-lg">
                {lang === 'he' ? reward.title : (reward.titleEn || reward.title)}
              </h3>
              <p className="text-slate-400 text-sm">{reward.business}</p>
            </div>
          </>
        )}

        {/* QR Code */}
        {voucher.qrData && (
          <div className="bg-white p-4 rounded-2xl mx-auto w-fit">
            <img src={voucher.qrData} alt="QR Code" className="w-48 h-48" />
          </div>
        )}

        {/* Code */}
        <div className="bg-carma-dark rounded-xl p-3 font-mono text-xl font-bold tracking-widest text-brand-400 border border-brand-500/30">
          {voucher.code}
        </div>

        {/* Status */}
        <div className="flex justify-center gap-3">
          <Badge variant={voucher.isUsed ? 'default' : isExpired ? 'danger' : 'success'}>
            {voucher.isUsed ? t('marketplace.voucher.used') : isExpired ? 'פג תוקף' : t('marketplace.voucher.active')}
          </Badge>
          <span className="text-sm text-slate-400">
            {t('marketplace.voucher.expiry')}: {formatDate(voucher.expiresAt, lang)}
          </span>
        </div>
      </div>
    </Modal>
  )
}

export default VoucherModal
