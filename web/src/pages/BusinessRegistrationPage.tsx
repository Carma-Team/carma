import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from '@/hooks/useTranslation';
import { startPhoneVerification, verifyOtp } from '@/lib/auth/otpApi';
import { geocodeAddress } from '@/lib/api/geocoding';
import {
  submitJoinRequest,
  BUSINESS_CATEGORIES,
  type BusinessCategory,
  type JoinRequestPayload,
} from '@/lib/api/businessRegistration';
import { LocationConfirmMap } from '@/components/business/LocationConfirmMap';
import { Card, Heading, Text, Button, Input, ErrorState, LoadingState } from '@/components/ui';
import inputStyles from '@/components/ui/Input.module.css';
import styles from './BusinessRegistrationPage.module.css';

// E.164 — the same shape the server's OtpRegisterIn/OtpRequestIn validate
// (server/app/schemas/auth.py). Checked here too so a malformed number never
// reaches the network only to bounce back as a 422.
const PHONE_PATTERN = '^\\+[1-9]\\d{6,14}$';

// Only ever used as a starting point for the applicant to correct when
// geocoding finds nothing — never a guess at their real location. See
// `LocationConfirmMap`'s own `hasMatch` handling for the same rule.
const ISRAEL_CENTER = { lat: 31.5, lng: 34.75 };

type FormState = {
  name: string;
  nameHe: string;
  category: BusinessCategory;
  address: string;
  lat: number;
  lng: number;
  registrationNumber: string;
  contactPerson: string;
  phone: string;
};

const EMPTY_FORM: FormState = {
  name: '',
  nameHe: '',
  category: 'other',
  address: '',
  lat: ISRAEL_CENTER.lat,
  lng: ISRAEL_CENTER.lng,
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
  | { kind: 'alreadyPending' }
  | { kind: 'error'; messageKey: 'rateLimitedMessage' | 'networkErrorMessage' | 'submitErrorMessage' };

export function BusinessRegistrationPage() {
  const { t } = useTranslation();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [step, setStep] = useState<Step>({ kind: 'form' });
  const [code, setCode] = useState('');
  const [otpError, setOtpError] = useState<string | null>(null);
  // Only meaningful while `step.kind === 'confirmLocation'` and geocoding
  // found nothing — the applicant must actively place a pin before
  // continuing, so the map's harmless-looking default center can never be
  // submitted as though it were their real answer.
  const [locationTouched, setLocationTouched] = useState(false);

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
      setLocationTouched(true);
      setStep({ kind: 'confirmLocation', hasMatch: true });
    } else if (result.outcome === 'not_found') {
      setForm((prev) => ({ ...prev, lat: ISRAEL_CENTER.lat, lng: ISRAEL_CENTER.lng }));
      setLocationTouched(false);
      setStep({ kind: 'confirmLocation', hasMatch: false });
    } else {
      setStep({ kind: 'geocodeError', reason: result.outcome });
    }
  }

  function useManualLocation() {
    setForm((prev) => ({ ...prev, lat: ISRAEL_CENTER.lat, lng: ISRAEL_CENTER.lng }));
    setLocationTouched(false);
    setStep({ kind: 'confirmLocation', hasMatch: false });
  }

  async function handleFormSubmit(event: FormEvent) {
    event.preventDefault();
    await runGeocode();
  }

  async function handleVerify(event: FormEvent) {
    event.preventDefault();
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
    } else if (submitResult.outcome === 'already_pending') {
      setStep({ kind: 'alreadyPending' });
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
      <main className={styles.page}>
        <LoadingState label={t(labelKey)} />
      </main>
    );
  }

  if (step.kind === 'success') {
    return (
      <main className={styles.page}>
        <Card className={styles.centered}>
          <Heading level={1}>{t('businessRegistration.pendingTitle')}</Heading>
          <Text variant="body">{t('businessRegistration.pendingMessage')}</Text>
          <Text variant="caption">{t('businessRegistration.pendingNotApprovalNote')}</Text>
          <Link to="/register/status" className={styles.statusLink}>
            {t('businessRegistration.checkStatusLink')}
          </Link>
        </Card>
      </main>
    );
  }

  if (step.kind === 'alreadyPending') {
    return (
      <main className={styles.page}>
        <Card className={styles.centered}>
          <Heading level={1}>{t('businessRegistration.alreadyPendingTitle')}</Heading>
          <Text variant="body">{t('businessRegistration.alreadyPendingMessage')}</Text>
          <Link to="/register/status" className={styles.statusLink}>
            {t('businessRegistration.checkStatusLink')}
          </Link>
        </Card>
      </main>
    );
  }

  if (step.kind === 'error') {
    return (
      <main className={styles.page}>
        <ErrorState
          title={t('businessRegistration.submitErrorTitle')}
          message={t(`businessRegistration.${step.messageKey}`)}
          retryLabel={t('common.retry')}
          onRetry={() => setStep({ kind: 'form' })}
        />
      </main>
    );
  }

  if (step.kind === 'geocodeError') {
    const titleKey = step.reason === 'rate_limited' ? 'geocodeRateLimitedTitle' : 'geocodeUnavailableTitle';
    const messageKey = step.reason === 'rate_limited' ? 'geocodeRateLimitedMessage' : 'geocodeUnavailableMessage';
    return (
      <main className={styles.page}>
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
      </main>
    );
  }

  if (step.kind === 'confirmLocation') {
    const canContinue = step.hasMatch || locationTouched;
    return (
      <main className={styles.page}>
        <Card className={styles.formCard}>
          <Heading level={1}>{t('businessRegistration.confirmLocationTitle')}</Heading>
          <Text variant="body">
            {t(step.hasMatch ? 'businessRegistration.confirmLocationFoundSubtitle' : 'businessRegistration.confirmLocationNotFoundSubtitle')}
          </Text>
          <LocationConfirmMap
            latitude={form.lat}
            longitude={form.lng}
            hasMatch={step.hasMatch}
            onChange={(lat, lng) => {
              updateField('lat', lat);
              updateField('lng', lng);
              setLocationTouched(true);
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
      </main>
    );
  }

  if (step.kind === 'otp' || step.kind === 'verifying') {
    const verifying = step.kind === 'verifying';
    return (
      <main className={styles.page}>
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
      </main>
    );
  }

  return (
    <main className={styles.page}>
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
          <div className={inputStyles.field}>
            <label htmlFor="business-category" className={inputStyles.label}>
              {t('businessRegistration.categoryLabel')}
            </label>
            <select
              id="business-category"
              className={inputStyles.input}
              required
              value={form.category}
              onChange={(event) => updateField('category', event.target.value as BusinessCategory)}
            >
              {BUSINESS_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {t(`businessRegistration.category${capitalize(category)}`)}
                </option>
              ))}
            </select>
          </div>
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
    </main>
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
