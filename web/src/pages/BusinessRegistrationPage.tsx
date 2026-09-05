import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from '@/hooks/useTranslation';
import { startPhoneVerification, verifyOtp } from '@/lib/auth/otpApi';
import { geocodeAddress } from '@/lib/api/geocoding';
import { submitJoinRequest, type JoinRequestPayload } from '@/lib/api/businessRegistration';
import { BUSINESS_CATEGORIES, type BusinessCategory } from '@/lib/businessCategory';
import { LocationConfirmMap } from '@/components/business/LocationConfirmMap';
import { Card, Heading, Text, Button, Input, Select, ErrorState, LoadingState } from '@/components/ui';
import { AuthCardShell } from '@/components/auth/AuthCardShell';
import styles from './BusinessRegistrationPage.module.css';

// E.164 — the same shape the server's OtpRegisterIn/OtpRequestIn validate
// (server/app/schemas/auth.py). Checked here too so a malformed number never
// reaches the network only to bounce back as a 422.
const PHONE_PATTERN = '^\\+[1-9]\\d{6,14}$';

type FormState = {
  name: string;
  nameHe: string;
  category: BusinessCategory;
  address: string;
  // `null` until a complete, valid, deliberately-chosen pair exists — never
  // a fallback center standing in for a real answer. See
  // `LocationConfirmMap`, which is the only thing allowed to fill these in.
  lat: number | null;
  lng: number | null;
  registrationNumber: string;
  contactPerson: string;
  phone: string;
};

const EMPTY_FORM: FormState = {
  name: '',
  nameHe: '',
  category: 'other',
  address: '',
  lat: null,
  lng: null,
  registrationNumber: '',
  contactPerson: '',
  phone: '',
};

type Step =
  | { kind: 'form' }
  | { kind: 'geocoding' }
  | { kind: 'geocodeError'; reason: 'rate_limited' | 'unavailable' }
  | { kind: 'confirmLocation'; hasMatch: boolean }
  | { kind: 'sendingOtp' }
  | { kind: 'otp' }
  | { kind: 'verifying' }
  | { kind: 'submitting' }
  | { kind: 'success' }
  // `reason` mirrors `submitJoinRequest`'s CAR-264 outcomes. `'unknown'`
  // covers the old collapsed `conflict` outcome — a 409 whose `code` is
  // missing or unrecognized — and gets the same honest, non-specific
  // message that used to cover every conflict.
  | {
      kind: 'submitConflict';
      reason: 'already_has_pending_request' | 'registration_number_pending' | 'registration_number_taken' | 'unknown';
    }
  | { kind: 'error'; messageKey: 'rateLimitedMessage' | 'networkErrorMessage' | 'submitErrorMessage' };

export function BusinessRegistrationPage() {
  const { t } = useTranslation();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [step, setStep] = useState<Step>({ kind: 'form' });
  const [code, setCode] = useState('');
  const [otpError, setOtpError] = useState<string | null>(null);

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function sendOtp() {
    setStep({ kind: 'sendingOtp' });
    const result = await startPhoneVerification(form.phone, form.contactPerson);
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

  // Shared by the form's submit and the geocode-error step's "Try again" —
  // neither touches `form`'s other fields, so a rate-limit or outage never
  // costs the applicant anything they already typed.
  async function runGeocode() {
    setStep({ kind: 'geocoding' });
    // Address text is the primary input; this derives the pin from it. Never
    // the device's own position — `geocodeAddress` only ever reads the
    // typed string, and there is no `navigator.geolocation` call anywhere
    // in this flow.
    const result = await geocodeAddress(form.address);
    if (result.outcome === 'found') {
      setForm((prev) => ({ ...prev, lat: result.lat, lng: result.lng }));
      setStep({ kind: 'confirmLocation', hasMatch: true });
    } else if (result.outcome === 'not_found') {
      // Left `null` deliberately — the map must open with no pin, not one
      // sitting on a meaningless fallback point that looks like an answer.
      setForm((prev) => ({ ...prev, lat: null, lng: null }));
      setStep({ kind: 'confirmLocation', hasMatch: false });
    } else {
      setStep({ kind: 'geocodeError', reason: result.outcome });
    }
  }

  function useManualLocation() {
    setForm((prev) => ({ ...prev, lat: null, lng: null }));
    setStep({ kind: 'confirmLocation', hasMatch: false });
  }

  async function handleFormSubmit(event: FormEvent) {
    event.preventDefault();
    await runGeocode();
  }

  async function handleVerify(event: FormEvent) {
    event.preventDefault();
    // Unreachable via the UI — the confirm-location step's "Continue" is
    // disabled until both are set — but this is what makes the compiler,
    // not just the disabled button, the reason a submission can never carry
    // a missing coordinate.
    if (form.lat === null || form.lng === null) return;

    setStep({ kind: 'verifying' });
    const result = await verifyOtp(form.phone, code);
    if (result.outcome !== 'ok') {
      setStep({ kind: 'otp' });
      if (result.outcome === 'invalid_code') setOtpError(t('businessRegistration.invalidCodeError'));
      else if (result.outcome === 'rate_limited') setOtpError(t('businessRegistration.rateLimitedMessage'));
      else setOtpError(t('businessRegistration.networkErrorMessage'));
      return;
    }

    // `result.accessToken` lives only in this closure — never written to
    // `lib/auth/session.ts`'s shared store, which `AuthProvider` reads
    // app-wide. It is used for exactly the one call below and then discarded
    // (nothing here keeps it beyond this function returning).
    setStep({ kind: 'submitting' });
    const payload: JoinRequestPayload = {
      name: form.name,
      nameHe: form.nameHe || null,
      category: form.category,
      address: form.address,
      locationLat: form.lat,
      locationLng: form.lng,
      registrationNumber: form.registrationNumber,
      contactPerson: form.contactPerson,
    };
    const submitResult = await submitJoinRequest(payload, result.accessToken);
    if (submitResult.outcome === 'ok') {
      setStep({ kind: 'success' });
    } else if (
      submitResult.outcome === 'already_has_pending_request' ||
      submitResult.outcome === 'registration_number_pending' ||
      submitResult.outcome === 'registration_number_taken'
    ) {
      setStep({ kind: 'submitConflict', reason: submitResult.outcome });
    } else if (submitResult.outcome === 'conflict') {
      setStep({ kind: 'submitConflict', reason: 'unknown' });
    } else if (submitResult.outcome === 'rate_limited') {
      setStep({ kind: 'error', messageKey: 'rateLimitedMessage' });
    } else if (submitResult.outcome === 'network_error') {
      setStep({ kind: 'error', messageKey: 'networkErrorMessage' });
    } else {
      setStep({ kind: 'error', messageKey: 'submitErrorMessage' });
    }
  }

  if (step.kind === 'sendingOtp' || step.kind === 'submitting' || step.kind === 'geocoding') {
    const labelKey =
      step.kind === 'geocoding'
        ? 'businessRegistration.geocodingLabel'
        : step.kind === 'sendingOtp'
          ? 'businessRegistration.sendingOtpLabel'
          : 'businessRegistration.submittingLabel';
    return (
      <AuthCardShell>
        <LoadingState label={t(labelKey)} />
      </AuthCardShell>
    );
  }

  if (step.kind === 'success') {
    return (
      <AuthCardShell>
        <Card className={styles.centered}>
          <Heading level={1}>{t('businessRegistration.pendingTitle')}</Heading>
          <Text variant="body">{t('businessRegistration.pendingMessage')}</Text>
          <Text variant="caption">{t('businessRegistration.pendingNotApprovalNote')}</Text>
          <Link to="/register/status" className={styles.statusLink}>
            {t('businessRegistration.checkStatusLink')}
          </Link>
        </Card>
      </AuthCardShell>
    );
  }

  if (step.kind === 'submitConflict') {
    const keySuffix =
      step.reason === 'already_has_pending_request'
        ? 'AlreadyPending'
        : step.reason === 'registration_number_pending'
          ? 'NumberPending'
          : step.reason === 'registration_number_taken'
            ? 'NumberTaken'
            : '';
    // The link only ever points at *this* applicant's own request status.
    // `already_has_pending_request` is that request, and `unknown` (a
    // missing/unrecognized code) preserves the old fallback behaviour. The
    // other two reasons name someone else's request or an already-approved
    // business — never the caller's — so the link would send them to a
    // status page for a request that isn't theirs, or doesn't exist.
    const showStatusLink = step.reason === 'already_has_pending_request' || step.reason === 'unknown';
    return (
      <AuthCardShell>
        <Card className={styles.centered}>
          <Heading level={1}>{t(`businessRegistration.submitConflict${keySuffix}Title`)}</Heading>
          <Text variant="body">{t(`businessRegistration.submitConflict${keySuffix}Message`)}</Text>
          {showStatusLink && (
            <Link to="/register/status" className={styles.statusLink}>
              {t('businessRegistration.checkStatusLink')}
            </Link>
          )}
        </Card>
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
          onRetry={() => setStep({ kind: 'form' })}
        />
      </AuthCardShell>
    );
  }

  if (step.kind === 'geocodeError') {
    const titleKey = step.reason === 'rate_limited' ? 'geocodeRateLimitedTitle' : 'geocodeUnavailableTitle';
    const messageKey = step.reason === 'rate_limited' ? 'geocodeRateLimitedMessage' : 'geocodeUnavailableMessage';
    return (
      <AuthCardShell>
        <Card className={styles.centered}>
          <Heading level={1}>{t(`businessRegistration.${titleKey}`)}</Heading>
          <Text variant="body">{t(`businessRegistration.${messageKey}`)}</Text>
          <div className={styles.actions}>
            <Button type="button" onClick={runGeocode}>
              {t('businessRegistration.geocodeRetryButton')}
            </Button>
            <Button type="button" variant="secondary" onClick={useManualLocation}>
              {t('businessRegistration.geocodeManualLocationButton')}
            </Button>
          </div>
        </Card>
      </AuthCardShell>
    );
  }

  if (step.kind === 'confirmLocation') {
    const canContinue = form.lat !== null && form.lng !== null;
    return (
      <AuthCardShell>
        <Card className={styles.formCard}>
          <Heading level={1}>{t('businessRegistration.confirmLocationTitle')}</Heading>
          <Text variant="body">
            {t(step.hasMatch ? 'businessRegistration.confirmLocationFoundSubtitle' : 'businessRegistration.confirmLocationNotFoundSubtitle')}
          </Text>
          <LocationConfirmMap
            latitude={form.lat}
            longitude={form.lng}
            onChange={(lat, lng) => {
              updateField('lat', lat);
              updateField('lng', lng);
            }}
            latLabel={t('businessRegistration.latLabel')}
            lngLabel={t('businessRegistration.lngLabel')}
          />
          <Text variant="caption">{t('businessRegistration.osmAttributionNote')}</Text>
          <div className={styles.actions}>
            <Button type="button" disabled={!canContinue} onClick={sendOtp}>
              {t('businessRegistration.confirmLocationContinueButton')}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setStep({ kind: 'form' })}>
              {t('businessRegistration.confirmLocationBackButton')}
            </Button>
          </div>
        </Card>
      </AuthCardShell>
    );
  }

  if (step.kind === 'otp' || step.kind === 'verifying') {
    const verifying = step.kind === 'verifying';
    return (
      <AuthCardShell>
        <Card className={styles.centered}>
          <Heading level={1}>{t('businessRegistration.otpTitle')}</Heading>
          <Text variant="body">{t('businessRegistration.otpSubtitle')}</Text>
          <Text variant="label" dir="ltr">
            {form.phone}
          </Text>
          <form onSubmit={handleVerify}>
            <Input
              label={t('businessRegistration.codeLabel')}
              inputMode="numeric"
              dir="ltr"
              required
              className={styles.otpInput}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              error={otpError ?? undefined}
            />
            <div className={styles.actions}>
              <Button type="submit" disabled={verifying}>
                {verifying ? t('businessRegistration.verifyingLabel') : t('businessRegistration.verifyButton')}
              </Button>
              <Button type="button" variant="secondary" disabled={verifying} onClick={sendOtp}>
                {t('businessRegistration.resendButton')}
              </Button>
              <Button type="button" variant="secondary" disabled={verifying} onClick={() => setStep({ kind: 'form' })}>
                {t('businessRegistration.changePhoneButton')}
              </Button>
            </div>
          </form>
        </Card>
      </AuthCardShell>
    );
  }

  return (
    <AuthCardShell>
      <Card className={styles.formCard}>
        <Heading level={1}>{t('businessRegistration.title')}</Heading>
        <Text variant="body">{t('businessRegistration.subtitle')}</Text>
        <form onSubmit={handleFormSubmit} className={styles.form}>
          <Input
            label={t('businessRegistration.nameLabel')}
            required
            minLength={2}
            maxLength={120}
            value={form.name}
            onChange={(event) => updateField('name', event.target.value)}
          />
          <Input
            label={t('businessRegistration.nameHeLabel')}
            maxLength={120}
            value={form.nameHe}
            onChange={(event) => updateField('nameHe', event.target.value)}
          />
          <Select
            id="business-category"
            label={t('businessRegistration.categoryLabel')}
            required
            value={form.category}
            onChange={(event) => updateField('category', event.target.value as BusinessCategory)}
          >
            {BUSINESS_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {t(`businessRegistration.category${capitalize(category)}`)}
              </option>
            ))}
          </Select>
          <Input
            label={t('businessRegistration.addressLabel')}
            required
            minLength={2}
            maxLength={200}
            value={form.address}
            onChange={(event) => updateField('address', event.target.value)}
          />
          <Input
            label={t('businessRegistration.registrationNumberLabel')}
            required
            value={form.registrationNumber}
            onChange={(event) => updateField('registrationNumber', event.target.value)}
          />
          <Text variant="caption">{t('businessRegistration.registrationNumberHint')}</Text>
          <Input
            label={t('businessRegistration.contactPersonLabel')}
            required
            minLength={2}
            maxLength={120}
            value={form.contactPerson}
            onChange={(event) => updateField('contactPerson', event.target.value)}
          />
          <Input
            label={t('businessRegistration.phoneLabel')}
            type="tel"
            dir="ltr"
            required
            pattern={PHONE_PATTERN}
            title={t('businessRegistration.phoneFormatError')}
            value={form.phone}
            onChange={(event) => updateField('phone', event.target.value)}
          />
          <Text variant="caption">{t('businessRegistration.phoneHint')}</Text>
          <Button type="submit" style={{ marginTop: 'var(--space-md)' }}>
            {t('businessRegistration.continueButton')}
          </Button>
        </form>
        <div className={styles.statusPrompt}>
          <Text variant="caption">{t('businessRegistration.checkStatusPrompt')}</Text>
          <Link to="/register/status">{t('businessRegistration.checkStatusLink')}</Link>
        </div>
      </Card>
    </AuthCardShell>
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
