import { useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '@/hooks/useTranslation';
import { useCountdown, formatCountdown } from '@/hooks/useCountdown';
import { peekVoucher, consumeVoucher, isWellFormedVoucherCode, type Voucher, type VoucherResult } from '@/lib/api/vouchers';
import { categoryTranslationKey, localizedRewardText } from '@/lib/rewardState';
import { normalizeBusinessCategory } from '@/lib/businessCategory';
import { Card, Heading, Text, Button, Input, Dialog, LoadingState, Alert, StatusBadge, CategoryIcon, type AlertTone } from '@/components/ui';
import type { TranslationMap } from '@/i18n/types';
import styles from './RedemptionPage.module.css';

// enter -> peek -> review -> explicit confirm -> consume -> success, per CAR-68.
// `review` is only ever entered for a PENDING voucher — a peek that resolves
// to any other status goes straight to `failure` (see `reviewOutcome`), per
// the approved design (CARMA Voucher Redemption, frame 04's note): a repeat
// lookup after real redemption surfaces the same card as a conflict caught at
// confirm time. `failure` carries the outcome that put the cashier there, so
// CAR-69's copy and recovery can be per-outcome without ever risking a failed
// lookup or redeem reading as success.
type Step =
  | { kind: 'entry' }
  | { kind: 'peeking' }
  | { kind: 'review'; voucher: Voucher }
  | { kind: 'confirming'; voucher: Voucher }
  | { kind: 'redeeming'; voucher: Voucher }
  | { kind: 'success'; voucher: Voucher }
  | { kind: 'failure'; failure: Failure };

// Mirrors VoucherResult's non-'ok' outcomes, plus the extra context a few of
// them need to render honestly: how many seconds until a rate limit clears,
// when an already-used voucher was actually redeemed, when a voucher expired
// (only known once a voucher object is in hand), and — for network_error,
// expired and unexpected_error — which side of the flow the failure
// interrupted. The same server outcome reads very differently depending on
// when it was discovered: a dropped connection during the initial lookup
// means the voucher was never checked; the same failure during confirm means
// it *was* checked but the redemption itself is now unconfirmed. Likewise a
// voucher that has simply been expired for days (found on lookup) is not the
// same situation as one that expired in the seconds between lookup and
// confirm (found only as a 409) — see failureCopyKeys.
// `unexpected_error`'s `notConsumed` is deliberately unlike `network_error`:
// vouchers.ts reserves `network_error` for *no response at all* (offline,
// DNS, CORS, a dropped connection), so a confirm-time network_error can
// honestly say "we don't know" without checking anything further. But
// `unexpected_error` is vouchers.ts's catch-all for a response that *did*
// arrive — any other status, a 409 with an unrecognized code, or a body that
// failed to parse — and its own comment says the request "may well have
// reached the server." At confirm time that means the redemption may have
// actually gone through despite the client-side failure, so whether it's
// safe to say "not consumed" is only known once a re-peek confirms it (see
// handleConfirm) — `undefined`/`false` must render as unresolved, never as
// a safe-to-retry claim.
type Failure =
  | { outcome: 'not_valid_here' }
  | { outcome: 'already_used'; redeemedAt: string | null }
  | { outcome: 'expired'; phase: 'lookup' | 'confirm'; expiresAt: string | null }
  | { outcome: 'rate_limited'; retryAfterSeconds: number | null }
  | { outcome: 'network_error'; phase: 'lookup' | 'confirm' }
  | { outcome: 'unexpected_error'; phase: 'lookup' | 'confirm'; notConsumed?: boolean };

// The outcomes whose copy never depends on which phase discovered them.
const FAILURE_KEYS: Record<
  'not_valid_here' | 'already_used' | 'rate_limited',
  { title: keyof TranslationMap['redemption']; message: keyof TranslationMap['redemption'] }
> = {
  not_valid_here: { title: 'failureNotValidTitle', message: 'failureNotValidMessage' },
  already_used: { title: 'failureAlreadyUsedTitle', message: 'failureAlreadyUsedMessage' },
  rate_limited: { title: 'failureRateLimitedTitle', message: 'failureRateLimitedMessage' },
};

const FAILURE_TONE: Record<Failure['outcome'], AlertTone> = {
  not_valid_here: 'danger',
  already_used: 'warning',
  expired: 'warning',
  rate_limited: 'warning',
  network_error: 'neutral',
  unexpected_error: 'danger',
};

function failureCopyKeys(failure: Failure): { title: keyof TranslationMap['redemption']; message: keyof TranslationMap['redemption'] } {
  switch (failure.outcome) {
    case 'network_error':
      return failure.phase === 'confirm'
        ? { title: 'failureConfirmNetworkTitle', message: 'failureConfirmNetworkMessage' }
        : { title: 'failureNetworkTitle', message: 'failureNetworkMessage' };
    case 'expired':
      // A voucher discovered expired on lookup has simply been sitting past
      // its TTL — statusExpired's plain "voucher expired" reads correctly.
      // One that expired in the gap between lookup and confirm needs the
      // timing-specific explanation instead (the driver just missed it).
      return failure.phase === 'confirm'
        ? { title: 'failureExpiredTitle', message: 'failureExpiredMessage' }
        : { title: 'statusExpired', message: 'failureAlreadyExpiredMessage' };
    case 'unexpected_error':
      // Only a re-peek that actually confirmed the voucher is still not USED
      // (handleConfirm's reconciliation) earns the reassuring "not consumed"
      // copy — an unresolved confirm-phase failure gets the same
      // don't-hand-over-the-goods framing as a confirm-phase network error,
      // never a guess dressed up as a fact.
      if (failure.phase !== 'confirm') return { title: 'failureUnexpectedTitle', message: 'failureUnexpectedMessage' };
      return failure.notConsumed
        ? { title: 'failureConfirmUnexpectedTitle', message: 'failureConfirmUnexpectedMessage' }
        : { title: 'failureConfirmUnexpectedUnknownTitle', message: 'failureConfirmUnexpectedUnknownMessage' };
    default:
      return FAILURE_KEYS[failure.outcome];
  }
}

function toFailure(result: Exclude<VoucherResult, { outcome: 'ok' }>, phase: 'lookup' | 'confirm'): Failure {
  // Peek's own 409 never carries this code — peek_voucher in
  // server/app/services/business.py always answers 200 with the voucher's
  // current status, only consume_voucher's conditional UPDATE can 409
  // VOUCHER_ALREADY_USED/VOUCHER_EXPIRED. These two branches stay because
  // VoucherResult is shared by both peek and consume (CAR-67), so this has to
  // stay exhaustive over it; a peeked already-used/expired voucher is caught
  // earlier by reviewOutcome and never reaches toFailure with phase='lookup'.
  if (result.outcome === 'already_used') return { outcome: 'already_used', redeemedAt: null };
  if (result.outcome === 'expired') return { outcome: 'expired', phase, expiresAt: null };
  if (result.outcome === 'rate_limited') return { outcome: 'rate_limited', retryAfterSeconds: result.retryAfterSeconds };
  if (result.outcome === 'network_error') return { outcome: 'network_error', phase };
  if (result.outcome === 'unexpected_error') return { outcome: 'unexpected_error', phase };
  return { outcome: result.outcome };
}

// peek_voucher always answers 200 with the voucher's current status rather
// than a 404/409 for a used or expired code — so a code that resolves to a
// non-pending voucher lands here, not in toFailure. The approved design
// (frame 04's note) treats this the same as the matching consume-time
// conflict: same card, same copy, no "valid-looking" card with a disabled
// button in between.
function reviewOutcome(voucher: Voucher): { kind: 'valid' } | { kind: 'failure'; failure: Failure } {
  if (voucher.status === 'pending') return { kind: 'valid' };
  if (voucher.status === 'used') return { kind: 'failure', failure: { outcome: 'already_used', redeemedAt: voucher.redeemedAt } };
  if (voucher.status === 'expired') {
    return { kind: 'failure', failure: { outcome: 'expired', phase: 'lookup', expiresAt: voucher.expiresAt } };
  }
  // 'cancelled' is in the server's RedemptionStatus enum but no code ever
  // writes it (server/app/services/rewards.py's VOUCHER_TTL_DAYS comment) —
  // an unreachable defensive fallback, not a designed state.
  return { kind: 'failure', failure: { outcome: 'not_valid_here' } };
}

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
      const outcome = reviewOutcome(result.voucher);
      setStep(outcome.kind === 'valid' ? { kind: 'review', voucher: result.voucher } : { kind: 'failure', failure: outcome.failure });
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
    if (result.outcome === 'unexpected_error') {
      // Unlike network_error — vouchers.ts reserves that for no response at
      // all — an unexpected_error response can arrive *after* the request
      // reached the server (a bad status, an unrecognized 409 code, a body
      // that failed to parse; see toResult's own comment), so the redemption
      // may have actually gone through. Telling the cashier it definitely
      // didn't would be a guess dressed up as a fact, so this re-peeks
      // before saying anything — same guard-held-through-the-lookup shape as
      // the already_used recovery above, for the same reason.
      const peeked = await peekVoucher(voucher.code);
      redeemInFlight.current = false;
      if (peeked.outcome === 'ok' && peeked.voucher.status === 'used') {
        // The redemption did go through — this is the exact same state a
        // fresh peek or a 409 would have reported, so it gets that card,
        // not a special-cased "well, actually" variant of this one.
        setStep({ kind: 'failure', failure: { outcome: 'already_used', redeemedAt: peeked.voucher.redeemedAt } });
        return;
      }
      // Any other resolved status (pending, expired, ...) rules out 'used'
      // and so proves the voucher was not consumed — only that case may
      // render the reassuring copy. A re-peek that itself fails to resolve
      // proves nothing either way and must stay in the unresolved state.
      setStep({
        kind: 'failure',
        failure: { outcome: 'unexpected_error', phase: 'confirm', notConsumed: peeked.outcome === 'ok' && peeked.voucher.status !== 'used' },
      });
      return;
    }
    redeemInFlight.current = false;
    setStep({ kind: 'failure', failure: toFailure(result, 'confirm') });
  }

  if (step.kind === 'entry') {
    return (
      <div className={styles.entryWrap}>
        <div className={styles.hero}>
          <Heading level={1}>{t('redemption.title')}</Heading>
          <Text variant="body">{t('redemption.subtitle')}</Text>
        </div>
        <Card className={styles.entryCard}>
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
            <Button type="submit" className={styles.fullWidth}>
              {t('redemption.checkButton')}
            </Button>
          </form>
        </Card>
      </div>
    );
  }

  if (step.kind === 'peeking') {
    return (
      <Card className={styles.centered}>
        <LoadingState label={t('redemption.checkingLabel')} />
      </Card>
    );
  }

  if (step.kind === 'failure') {
    return <FailureCard failure={step.failure} onBackToEntry={resetToEntry} />;
  }

  if (step.kind === 'success') {
    const { voucher } = step;
    const title = lang === 'HE'
      ? localizedRewardText(voucher.reward.titleHe, voucher.reward.titleEn)
      : localizedRewardText(voucher.reward.titleEn, voucher.reward.titleHe);
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
          <Button variant="primary" className={styles.fullWidth} onClick={resetToEntry}>
            {t('redemption.redeemAnotherButton')}
          </Button>
          <Button variant="text" className={styles.mutedAction} onClick={() => navigate('/')}>
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
  // voucher.status is always 'pending' here — reviewOutcome routes anything
  // else straight to the failure card — so the only way this can go false is
  // the live countdown ticking to zero while this card is already on screen.
  const canRedeem = voucher.status === 'pending' && !expired;
  const dialogOpen = step.kind === 'confirming' || step.kind === 'redeeming';
  const submitting = step.kind === 'redeeming';

  const title = lang === 'HE'
    ? localizedRewardText(voucher.reward.titleHe, voucher.reward.titleEn)
    : localizedRewardText(voucher.reward.titleEn, voucher.reward.titleHe);
  const category = normalizeBusinessCategory(voucher.reward.category);
  const categoryLabel = t(`rewards.${categoryTranslationKey(category)}`);

  return (
    <Card className={styles.reviewCard}>
      <StatusBadge tone={canRedeem ? 'success' : 'neutral'}>
        {canRedeem ? t('redemption.statusPending') : t('redemption.expiredLabel')}
      </StatusBadge>

      <div className={styles.rewardSummary}>
        <CategoryIcon category={category} label={categoryLabel} size="lg" />
        <Heading level={2}>{title}</Heading>
        <Text variant="caption">
          {t('redemption.costPointsLabel')} <span className={styles.costValue}>{voucher.pointsCost}</span>
        </Text>
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
      <div className={styles.detailRow}>
        <Text variant="caption">{t('redemption.timeRemainingLabel')}</Text>
        <Text variant="label" dir="ltr" className={styles.countdown}>
          {expired ? t('redemption.expiredLabel') : formatCountdown(remainingMs)}
        </Text>
      </div>

      {!canRedeem && <Text variant="caption">{t('redemption.notRedeemableMessage')}</Text>}

      <div className={styles.actions}>
        <Button variant="primary" className={styles.fullWidth} disabled={!canRedeem} onClick={() => onOpenConfirm(voucher)}>
          {t('redemption.redeemButton')}
        </Button>
        <Button variant="text" className={styles.mutedAction} disabled={submitting} onClick={onBackToEntry}>
          {t('redemption.backToEntry')}
        </Button>
      </div>

      <Dialog
        open={dialogOpen}
        onClose={() => onCloseDialog(voucher)}
        title={t('redemption.confirmTitle')}
        closeLabel={t('redemption.confirmCloseLabel')}
        tone="warning"
      >
        <Text variant="body">{t('redemption.confirmBody')}</Text>
        <div className={styles.confirmSummary}>
          <CategoryIcon category={category} label={categoryLabel} />
          <Text variant="label">{title}</Text>
          <span className={styles.confirmDivider} aria-hidden="true" />
          <Text variant="caption">{voucher.pointsCost}</Text>
        </div>
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
    <div className={styles.failureWrap}>
      <Alert
        tone={FAILURE_TONE[failure.outcome]}
        title={t(`redemption.${keys.title}`)}
        action={
          <Button variant="primary" onClick={onBackToEntry}>
            {t('redemption.tryAnotherCodeButton')}
          </Button>
        }
      >
        <Text variant="body">{t(`redemption.${keys.message}`)}</Text>

        {failure.outcome === 'already_used' && failure.redeemedAt && (
          <div className={styles.detailRow}>
            <Text variant="caption">{t('redemption.redeemedAtLabel')}</Text>
            <Text variant="label" dir="ltr">
              {new Date(failure.redeemedAt).toLocaleString(lang === 'HE' ? 'he-IL' : 'en-US')}
            </Text>
          </div>
        )}
        {failure.outcome === 'expired' && failure.expiresAt && (
          <div className={styles.detailRow}>
            <Text variant="caption">{t('redemption.expiresLabel')}</Text>
            <Text variant="label" dir="ltr">
              {new Date(failure.expiresAt).toLocaleString(lang === 'HE' ? 'he-IL' : 'en-US')}
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
      </Alert>
    </div>
  );
}
