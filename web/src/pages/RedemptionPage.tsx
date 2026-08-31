import { useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '@/hooks/useTranslation';
import { useCountdown, formatCountdown } from '@/hooks/useCountdown';
import { peekVoucher, consumeVoucher, isWellFormedVoucherCode, type Voucher, type VoucherResult } from '@/lib/api/vouchers';
import { Card, Heading, Text, Button, Input, Dialog, LoadingState } from '@/components/ui';
import type { TranslationMap } from '@/i18n/types';
import styles from './RedemptionPage.module.css';

// enter -> peek -> review -> explicit confirm -> consume -> success, per CAR-68.
// `failure` carries the outcome that put the cashier there, so CAR-69's copy
// and recovery can be per-outcome without ever risking a failed lookup or
// redeem reading as success.
type Step =
  | { kind: 'entry' }
  | { kind: 'peeking' }
  | { kind: 'review'; voucher: Voucher }
  | { kind: 'confirming'; voucher: Voucher }
  | { kind: 'redeeming'; voucher: Voucher }
  | { kind: 'success'; voucher: Voucher }
  | { kind: 'failure'; failure: Failure };

// Mirrors VoucherResult's non-'ok' outcomes, plus the extra context a couple
// of them need to render honestly: how many seconds until a rate limit
// clears, when an already-used voucher was actually redeemed, and — for
// network_error — which side of the flow it interrupted. A dropped
// connection during the initial lookup means the voucher was never checked;
// the same failure during confirm means it *was* checked but the redemption
// itself is now unconfirmed, which is a different thing to tell a cashier.
type Failure =
  | { outcome: 'not_valid_here' }
  | { outcome: 'already_used'; redeemedAt: string | null }
  | { outcome: 'expired' }
  | { outcome: 'rate_limited'; retryAfterSeconds: number | null }
  | { outcome: 'network_error'; phase: 'lookup' | 'confirm' }
  | { outcome: 'unexpected_error' };

const FAILURE_KEYS: Record<
  Exclude<Failure['outcome'], 'network_error'>,
  { title: keyof TranslationMap['redemption']; message: keyof TranslationMap['redemption'] }
> = {
  not_valid_here: { title: 'failureNotValidTitle', message: 'failureNotValidMessage' },
  already_used: { title: 'failureAlreadyUsedTitle', message: 'failureAlreadyUsedMessage' },
  expired: { title: 'failureExpiredTitle', message: 'failureExpiredMessage' },
  rate_limited: { title: 'failureRateLimitedTitle', message: 'failureRateLimitedMessage' },
  unexpected_error: { title: 'failureUnexpectedTitle', message: 'failureUnexpectedMessage' },
};

function failureCopyKeys(failure: Failure): { title: keyof TranslationMap['redemption']; message: keyof TranslationMap['redemption'] } {
  if (failure.outcome === 'network_error') {
    return failure.phase === 'confirm'
      ? { title: 'failureConfirmNetworkTitle', message: 'failureConfirmNetworkMessage' }
      : { title: 'failureNetworkTitle', message: 'failureNetworkMessage' };
  }
  return FAILURE_KEYS[failure.outcome];
}

function toFailure(result: Exclude<VoucherResult, { outcome: 'ok' }>, phase: 'lookup' | 'confirm'): Failure {
  // Peek's own 409 never carries this code — peek_voucher in
  // server/app/services/business.py always answers 200 with the voucher's
  // current status, only consume_voucher's conditional UPDATE can 409
  // VOUCHER_ALREADY_USED. This branch stays because VoucherResult's
  // 'already_used' outcome is shared by both peek and consume (CAR-67), so
  // toFailure has to stay exhaustive over it; handleConfirm's own
  // already_used branch is the one this app actually reaches, and it never
  // calls toFailure — it builds its Failure directly, with the re-peeked
  // redeemedAt this generic fallback has no way to fetch.
  if (result.outcome === 'already_used') return { outcome: 'already_used', redeemedAt: null };
  if (result.outcome === 'rate_limited') return { outcome: 'rate_limited', retryAfterSeconds: result.retryAfterSeconds };
  if (result.outcome === 'network_error') return { outcome: 'network_error', phase };
  return { outcome: result.outcome };
}

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
  const [codeError, setCodeError] = useState<string | null>(null);
  // A ref, not state: it must be visible to a second click handler firing
  // before React has re-rendered and disabled the confirm button.
  const redeemInFlight = useRef(false);

  // Guarded by the same ref as handleConfirm: while a consume request is in
  // flight, nothing may leave the 'redeeming' step — not Escape, not the
  // dialog's close button, not this reset — or the in-flight guard would be
  // cleared out from under a request that hasn't settled yet, opening the
  // door to a second one.
  function resetToEntry() {
    if (redeemInFlight.current) return;
    setCode('');
    setCodeError(null);
    setStep({ kind: 'entry' });
  }

  async function handleCheckCode(event: FormEvent) {
    event.preventDefault();
    // A malformed code — wrong length, or a character outside the voucher
    // alphabet — is rejected here, before any request goes out. It is always
    // a typo or a misheard character, never a real voucher, so there is
    // nothing for the server to usefully answer.
    if (!isWellFormedVoucherCode(code)) {
      setCodeError(t('redemption.codeFormatError'));
      return;
    }
    setCodeError(null);
    setStep({ kind: 'peeking' });
    const result = await peekVoucher(code);
    if (result.outcome === 'ok') {
      setStep({ kind: 'review', voucher: result.voucher });
    } else {
      setStep({ kind: 'failure', failure: toFailure(result, 'lookup') });
    }
  }

  // Guarded like resetToEntry and handleCloseDialog: the review card's own
  // Redeem button sits behind the confirm dialog but isn't disabled by
  // `submitting` (only by canRedeem), so without this check it would be
  // clickable — and native <dialog> inertness is the only other thing
  // stopping it — for the whole time a redeem or its already_used recovery
  // lookup is in flight.
  function handleOpenConfirm(voucher: Voucher) {
    if (redeemInFlight.current || voucher.status !== 'pending') return;
    setStep({ kind: 'confirming', voucher });
  }

  // Same guard as resetToEntry — closing the dialog (Escape, the "x", or our
  // own Cancel button) must not be able to back out of an in-flight consume.
  function handleCloseDialog(voucher: Voucher) {
    if (redeemInFlight.current) return;
    setStep({ kind: 'review', voucher });
  }

  async function handleConfirm(voucher: Voucher) {
    // Also refuses a voucher that ticked over to expired while the dialog
    // was already open — the countdown is live for as long as the review
    // card is mounted, which includes 'confirming' and 'redeeming'.
    if (redeemInFlight.current || new Date(voucher.expiresAt).getTime() <= Date.now()) return;
    redeemInFlight.current = true;
    setStep({ kind: 'redeeming', voucher });
    const result = await consumeVoucher(voucher.code);
    if (result.outcome === 'ok') {
      redeemInFlight.current = false;
      setStep({ kind: 'success', voucher: result.voucher });
      return;
    }
    if (result.outcome === 'already_used') {
      // The 409 body carries no voucher data, so the only way to show when it
      // was actually redeemed is to look again. The guard stays held for this
      // whole recovery lookup, not just the consume call — releasing it
      // early would let Escape, the dialog's close control or Cancel back
      // out to the stale (still-pending) voucher while this second request
      // is still in flight, opening the door to a second consumeVoucher call
      // racing this one (CAR-69 review). If the recovery lookup itself
      // fails, the failure still renders — just without a timestamp.
      const peeked = await peekVoucher(voucher.code);
      redeemInFlight.current = false;
      setStep({
        kind: 'failure',
        failure: { outcome: 'already_used', redeemedAt: peeked.outcome === 'ok' ? peeked.voucher.redeemedAt : null },
      });
      return;
    }
    redeemInFlight.current = false;
    setStep({ kind: 'failure', failure: toFailure(result, 'confirm') });
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
            error={codeError ?? undefined}
            value={code}
            onChange={(event) => {
              setCode(event.target.value);
              setCodeError(null);
            }}
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

  if (step.kind === 'failure') {
    return <FailureCard failure={step.failure} onBackToEntry={resetToEntry} />;
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
      {voucher.status === 'used' && voucher.redeemedAt && (
        <div className={styles.detailRow}>
          <Text variant="caption">{t('redemption.redeemedAtLabel')}</Text>
          <Text variant="label" dir="ltr">
            {new Date(voucher.redeemedAt).toLocaleString(lang === 'HE' ? 'he-IL' : 'en-US')}
          </Text>
        </div>
      )}

      {!canRedeem && <Text variant="caption">{t('redemption.notRedeemableMessage')}</Text>}

      <div className={styles.actions}>
        <Button variant="primary" disabled={!canRedeem} onClick={() => onOpenConfirm(voucher)}>
          {t('redemption.redeemButton')}
        </Button>
        <Button variant="secondary" disabled={submitting} onClick={onBackToEntry}>
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
          <Button
            variant="primary"
            disabled={submitting || !canRedeem}
            onClick={() => {
              if (canRedeem) onConfirm(voucher);
            }}
          >
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

function FailureCard({ failure, onBackToEntry }: { failure: Failure; onBackToEntry: () => void }) {
  const { t, lang } = useTranslation();
  const keys = failureCopyKeys(failure);

  return (
    <Card className={styles.centered} role="alert">
      <Heading level={2}>{t(`redemption.${keys.title}`)}</Heading>
      <Text variant="body">{t(`redemption.${keys.message}`)}</Text>

      {failure.outcome === 'already_used' && failure.redeemedAt && (
        <div className={styles.detailRow}>
          <Text variant="caption">{t('redemption.redeemedAtLabel')}</Text>
          <Text variant="label" dir="ltr">
            {new Date(failure.redeemedAt).toLocaleString(lang === 'HE' ? 'he-IL' : 'en-US')}
          </Text>
        </div>
      )}
      {failure.outcome === 'rate_limited' && failure.retryAfterSeconds != null && (
        <div className={styles.detailRow}>
          <Text variant="caption">{t('redemption.retryAfterLabel')}</Text>
          <Text variant="label" dir="ltr">
            {failure.retryAfterSeconds}
          </Text>
        </div>
      )}

      <div className={styles.actions}>
        <Button variant="secondary" onClick={onBackToEntry}>
          {t('redemption.tryAnotherCodeButton')}
        </Button>
      </div>
    </Card>
  );
}
