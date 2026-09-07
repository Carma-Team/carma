import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from '@/hooks/useTranslation';
import { requestStatusCheckOtp, verifyOtp } from '@/lib/auth/otpApi';
import { getJoinRequestStatus, type JoinRequestStatusOut } from '@/lib/api/businessRegistration';
import { Card, Heading, Text, Button, Input, ErrorState, LoadingState } from '@/components/ui';
import { AuthCardShell } from '@/components/auth/AuthCardShell';
import styles from './BusinessRegistrationPage.module.css';

const PHONE_PATTERN = '^\\+[1-9]\\d{6,14}$';

type Step =
  | { kind: 'phone' }
  | { kind: 'sendingOtp' }
  | { kind: 'otp' }
  | { kind: 'verifying' }
  | { kind: 'result'; status: JoinRequestStatusOut }
  | { kind: 'error'; messageKey: 'rateLimitedMessage' | 'networkErrorMessage' | 'submitErrorMessage' };

const STATUS_KEYS: Record<
  Exclude<JoinRequestStatusOut['status'], 'none'>,
  { title: string; message: string; tone: 'warning' | 'success' | 'danger' }
> = {
  pending: { title: 'statusPendingTitle', message: 'statusPendingMessage', tone: 'warning' },
  approved: { title: 'statusApprovedTitle', message: 'statusApprovedMessage', tone: 'success' },
  rejected: { title: 'statusRejectedTitle', message: 'statusRejectedMessage', tone: 'danger' },
};

export function BusinessRequestStatusPage() {
  const { t, lang } = useTranslation();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<Step>({ kind: 'phone' });
  const [otpError, setOtpError] = useState<string | null>(null);

  async function sendOtp() {
    setStep({ kind: 'sendingOtp' });
    const result = await requestStatusCheckOtp(phone);
    if (result.outcome === 'ok') {
      setOtpError(null);
      setCode('');
      setStep({ kind: 'otp' });
    } else if (result.outcome === 'rate_limited') {
      setStep({ kind: 'error', messageKey: 'rateLimitedMessage' });
    } else if (result.outcome === 'network_error') {
      setStep({ kind: 'error', messageKey: 'networkErrorMessage' });
    } else {
      setStep({ kind: 'error', messageKey: 'submitErrorMessage' });
    }
  }

  async function handlePhoneSubmit(event: FormEvent) {
    event.preventDefault();
    await sendOtp();
  }

  async function handleVerify(event: FormEvent) {
    event.preventDefault();
    setStep({ kind: 'verifying' });
    const result = await verifyOtp(phone, code);
    if (result.outcome !== 'ok') {
      setStep({ kind: 'otp' });
      if (result.outcome === 'invalid_code') setOtpError(t('businessRegistration.invalidCodeError'));
      else if (result.outcome === 'rate_limited') setOtpError(t('businessRegistration.rateLimitedMessage'));
      else setOtpError(t('businessRegistration.networkErrorMessage'));
      return;
    }

    // `result.accessToken` is used for exactly this one lookup and then
    // discarded — never written to `lib/auth/session.ts`'s shared store
    // (see the equivalent note in BusinessRegistrationPage).
    const statusResult = await getJoinRequestStatus(result.accessToken);
    if (statusResult.outcome === 'ok') {
      setStep({ kind: 'result', status: statusResult.status });
    } else if (statusResult.outcome === 'network_error') {
      setStep({ kind: 'error', messageKey: 'networkErrorMessage' });
    } else {
      setStep({ kind: 'error', messageKey: 'submitErrorMessage' });
    }
  }

  if (step.kind === 'sendingOtp' || step.kind === 'verifying') {
    // Distinct copy per phase — this page only ever looks a status up, so
    // "verifying" must never borrow BusinessRegistrationPage's
    // submission-flavoured label.
    const label = step.kind === 'sendingOtp' ? t('businessRegistration.sendingOtpLabel') : t('requestStatus.verifyingLabel');
    return (
      <AuthCardShell>
        <LoadingState label={label} />
      </AuthCardShell>
    );
  }

  if (step.kind === 'error') {
    return (
      <AuthCardShell>
        <ErrorState
          title={t('businessRegistration.submitErrorTitle')}
          message={t(`businessRegistration.${step.messageKey}`)}
          retryLabel={t('common.retry')}
          onRetry={() => setStep({ kind: 'phone' })}
        />
      </AuthCardShell>
    );
  }

  if (step.kind === 'result') {
    if (step.status.status === 'none') {
      return (
        <AuthCardShell>
          <Card className={styles.centered}>
            <Heading level={1}>{t('requestStatus.statusNoneTitle')}</Heading>
            <Text variant="body">{t('requestStatus.statusNoneMessage')}</Text>
            <Link to="/register" className={styles.statusLink}>
              {t('requestStatus.backToRegisterLink')}
            </Link>
          </Card>
        </AuthCardShell>
      );
    }

    const copy = STATUS_KEYS[step.status.status];
    return (
      <AuthCardShell>
        <Card className={[styles.centered, styles[`statusCard-${copy.tone}`]].join(' ')}>
          <Heading level={1}>{t(`requestStatus.${copy.title}`)}</Heading>
          <Text variant="body">{t(`requestStatus.${copy.message}`)}</Text>
          {step.status.createdAt && (
            <Text variant="caption">
              {t('requestStatus.submittedAtLabel')}: {new Date(step.status.createdAt).toLocaleDateString(lang === 'HE' ? 'he-IL' : 'en-US')}
            </Text>
          )}
          {step.status.reviewerNote && (
            <Text variant="caption">
              {t('requestStatus.reviewerNoteLabel')}: {step.status.reviewerNote}
            </Text>
          )}
        </Card>
      </AuthCardShell>
    );
  }

  if (step.kind === 'otp') {
    return (
      <AuthCardShell>
        <Card className={styles.centered}>
          <Heading level={1}>{t('businessRegistration.otpTitle')}</Heading>
          <Text variant="body">{t('businessRegistration.otpSubtitle')}</Text>
          <Text variant="label" dir="ltr">
            {phone}
          </Text>
          <form onSubmit={handleVerify}>
            <Input
              label={t('requestStatus.codeLabel')}
              inputMode="numeric"
              dir="ltr"
              required
              className={styles.otpInput}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              error={otpError ?? undefined}
            />
            <div className={styles.actions}>
              <Button type="submit">{t('requestStatus.verifyButton')}</Button>
              <Button type="button" variant="secondary" onClick={sendOtp}>
                {t('requestStatus.resendButton')}
              </Button>
            </div>
          </form>
        </Card>
      </AuthCardShell>
    );
  }

  return (
    <AuthCardShell>
      <Card className={styles.centered}>
        <Heading level={1}>{t('requestStatus.title')}</Heading>
        <Text variant="body">{t('requestStatus.subtitle')}</Text>
        <form onSubmit={handlePhoneSubmit}>
          <Input
            label={t('requestStatus.phoneLabel')}
            type="tel"
            dir="ltr"
            required
            pattern={PHONE_PATTERN}
            title={t('businessRegistration.phoneFormatError')}
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
          <Button type="submit" style={{ marginTop: 'var(--space-md)' }}>
            {t('requestStatus.sendCodeButton')}
          </Button>
        </form>
        <div className={styles.statusPrompt}>
          <Link to="/register">{t('requestStatus.backToRegisterLink')}</Link>
        </div>
      </Card>
    </AuthCardShell>
  );
}
