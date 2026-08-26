import { useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '@/hooks/useTranslation';
import { useCountdown, formatCountdown } from '@/hooks/useCountdown';
import { peekVoucher, consumeVoucher, type Voucher } from '@/lib/api/vouchers';
import { Card, Heading, Text, Button, Input, Dialog, ErrorState, LoadingState } from '@/components/ui';
import type { TranslationMap } from '@/i18n/types';
import styles from './RedemptionPage.module.css';

// enter -> peek -> review -> explicit confirm -> consume -> success, per CAR-68.
// `error` is deliberately one generic step for every non-'ok' VoucherResult —
// CAR-69 owns per-outcome copy and recovery; this only guarantees a failed
// lookup or redeem never reads as success and never strands the cashier.
type Step =
  | { kind: 'entry' }
  | { kind: 'peeking' }
  | { kind: 'review'; voucher: Voucher }
  | { kind: 'confirming'; voucher: Voucher }
  | { kind: 'redeeming'; voucher: Voucher }
  | { kind: 'success'; voucher: Voucher }
  | { kind: 'error' };

const STATUS_KEY: Record<string, keyof TranslationMap['redemption']> = {
  pending: 'statusPending',
  used: 'statusUsed',
  expired: 'statusExpired',
  cancelled: 'statusCancelled',
};

export function RedemptionPage() {
  const { t, lang } = useTranslation();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>({ kind: 'entry' });
  const [code, setCode] = useState('');
  // A ref, not state: it must be visible to a second click handler firing
  // before React has re-rendered and disabled the confirm button.
  const redeemInFlight = useRef(false);

  function resetToEntry() {
    setCode('');
    redeemInFlight.current = false;
    setStep({ kind: 'entry' });
  }

  async function handleCheckCode(event: FormEvent) {
    event.preventDefault();
    setStep({ kind: 'peeking' });
    const result = await peekVoucher(code);
    if (result.outcome === 'ok') {
      setStep({ kind: 'review', voucher: result.voucher });
    } else {
      setStep({ kind: 'error' });
    }
  }

  function handleOpenConfirm(voucher: Voucher) {
    if (voucher.status !== 'pending') return;
    setStep({ kind: 'confirming', voucher });
  }

  function handleCloseDialog(voucher: Voucher) {
    setStep({ kind: 'review', voucher });
  }

  async function handleConfirm(voucher: Voucher) {
    if (redeemInFlight.current) return;
    redeemInFlight.current = true;
    setStep({ kind: 'redeeming', voucher });
    const result = await consumeVoucher(voucher.code);
    redeemInFlight.current = false;
    if (result.outcome === 'ok') {
      setStep({ kind: 'success', voucher: result.voucher });
    } else {
      setStep({ kind: 'error' });
    }
  }

  if (step.kind === 'entry') {
    return (
      <Card className={styles.centered}>
        <Heading level={1}>{t('redemption.title')}</Heading>
        <Text variant="body">{t('redemption.subtitle')}</Text>
        <form onSubmit={handleCheckCode} noValidate>
          <Input
            label={t('redemption.codeLabel')}
            placeholder={t('redemption.codePlaceholder')}
            dir="ltr"
            className={styles.codeInput}
            required
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          <Button type="submit" style={{ marginTop: 'var(--space-md)' }}>
            {t('redemption.checkButton')}
          </Button>
        </form>
      </Card>
    );
  }

  if (step.kind === 'peeking') {
    return <LoadingState label={t('redemption.checkingLabel')} />;
  }

  if (step.kind === 'error') {
    return (
      <ErrorState
        title={t('common.errorTitle')}
        message={t('common.errorMessage')}
        retryLabel={t('common.retry')}
        onRetry={resetToEntry}
      />
    );
  }

  if (step.kind === 'success') {
    const { voucher } = step;
    const title = lang === 'HE' ? voucher.reward.titleHe : (voucher.reward.titleEn ?? voucher.reward.titleHe);
    return (
      <Card className={styles.centered}>
        <span className={styles.successBadge} aria-hidden="true">
          ✓
        </span>
        <Heading level={1}>{t('redemption.successTitle')}</Heading>
        <Text variant="body">
          {title} · {voucher.pointsCost} · <span dir="ltr">{voucher.code}</span>
        </Text>
        <Text variant="caption">{t('redemption.successSubtitle')}</Text>
        <div className={styles.actions}>
          <Button variant="primary" onClick={resetToEntry}>
            {t('redemption.redeemAnotherButton')}
          </Button>
          <Button variant="secondary" onClick={() => navigate('/')}>
            {t('redemption.backToHomeButton')}
          </Button>
        </div>
      </Card>
    );
  }

  // review, confirming and redeeming all show the same review card — the
  // latter two additionally show the confirmation dialog over it.
  return (
    <ReviewCard
      step={step}
      onOpenConfirm={handleOpenConfirm}
      onConfirm={handleConfirm}
      onCloseDialog={handleCloseDialog}
      onBackToEntry={resetToEntry}
    />
  );
}

function ReviewCard({
  step,
  onOpenConfirm,
  onConfirm,
  onCloseDialog,
  onBackToEntry,
}: {
  step: Extract<Step, { kind: 'review' | 'confirming' | 'redeeming' }>;
  onOpenConfirm: (voucher: Voucher) => void;
  onConfirm: (voucher: Voucher) => void;
  onCloseDialog: (voucher: Voucher) => void;
  onBackToEntry: () => void;
}) {
  const { t, lang } = useTranslation();
  const { voucher } = step;
  const { remainingMs, expired } = useCountdown(voucher.expiresAt);
  const canRedeem = voucher.status === 'pending' && !expired;
  const dialogOpen = step.kind === 'confirming' || step.kind === 'redeeming';
  const submitting = step.kind === 'redeeming';

  const title = lang === 'HE' ? voucher.reward.titleHe : (voucher.reward.titleEn ?? voucher.reward.titleHe);
  const statusKey = STATUS_KEY[voucher.status] ?? 'statusPending';
  const statusLabel =
    expired && voucher.status === 'pending' ? t('redemption.expiredLabel') : t(`redemption.${statusKey}`);

  return (
    <Card className={styles.reviewCard}>
      <span className={styles.statusBadge} data-status={voucher.status}>
        {statusLabel}
      </span>
      <Heading level={2}>{title}</Heading>

      <div className={styles.detailRow}>
        <Text variant="caption">{t('redemption.costPointsLabel')}</Text>
        <Text variant="label">{voucher.pointsCost}</Text>
      </div>
      <div className={styles.detailRow}>
        <Text variant="caption">{t('redemption.codeLabel')}</Text>
        <Text variant="label" dir="ltr">
          {voucher.code}
        </Text>
      </div>
      <div className={styles.detailRow}>
        <Text variant="caption">{t('redemption.expiresLabel')}</Text>
        <Text variant="label" dir="ltr">
          {new Date(voucher.expiresAt).toLocaleString(lang === 'HE' ? 'he-IL' : 'en-US')}
        </Text>
      </div>
      {voucher.status === 'pending' && (
        <div className={styles.detailRow}>
          <Text variant="caption">{t('redemption.timeRemainingLabel')}</Text>
          <Text variant="label" dir="ltr" className={styles.countdown}>
            {expired ? t('redemption.expiredLabel') : formatCountdown(remainingMs)}
          </Text>
        </div>
      )}

      {!canRedeem && <Text variant="caption">{t('redemption.notRedeemableMessage')}</Text>}

      <div className={styles.actions}>
        <Button variant="primary" disabled={!canRedeem} onClick={() => onOpenConfirm(voucher)}>
          {t('redemption.redeemButton')}
        </Button>
        <Button variant="secondary" onClick={onBackToEntry}>
          {t('redemption.backToEntry')}
        </Button>
      </div>

      <Dialog
        open={dialogOpen}
        onClose={() => onCloseDialog(voucher)}
        title={t('redemption.confirmTitle')}
        closeLabel={t('redemption.confirmCloseLabel')}
      >
        <Text variant="body">{t('redemption.confirmBody')}</Text>
        <Text variant="label">
          {title} · {voucher.pointsCost}
        </Text>
        <div className={styles.actions}>
          <Button variant="primary" disabled={submitting} onClick={() => onConfirm(voucher)}>
            {t('redemption.confirmYes')}
          </Button>
          <Button variant="secondary" disabled={submitting} onClick={() => onCloseDialog(voucher)}>
            {t('redemption.confirmCancel')}
          </Button>
        </div>
      </Dialog>
    </Card>
  );
}
