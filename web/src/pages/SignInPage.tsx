import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { AuthApiError } from '@/lib/auth/authApi';
import { requestSignInOtp } from '@/lib/auth/otpApi';
import { Heading, Text, Input, Button, ErrorState, LoadingState } from '@/components/ui';
import { AuthSplitLayout } from '@/components/auth/AuthSplitLayout';
import styles from './SignInPage.module.css';

// Server's E.164 pattern (server/app/schemas/auth.py) — same check
// `BusinessRegistrationPage` runs client-side before ever hitting the network.
const PHONE_PATTERN = '^\\+[1-9]\\d{6,14}$';

type PhoneStep = 'phone' | 'sendingCode' | 'code' | 'verifying';

// The page a caller was on before being sent here — e.g. an invitation-accept
// link (CAR-118) for a signed-out recipient. Carried as router (history)
// state, never a query param: it never reaches the URL, so it never reaches
// server logs, analytics, or a browser's address-bar autocomplete the way a
// query param would — but it is still browser-held state, part of this
// session-history entry, not something that exists only in memory, and it
// does not survive a hard reload or a fresh tab the way the invitation's own
// URL fragment does (see `AcceptInvitationPage`).
type LocationState = { from?: string } | null;

export function SignInPage() {
  const { t } = useTranslation();
  const { login, loginWithOtp, status } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as LocationState)?.from ?? '/';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // CAR-265: a second door for an approved, phone-only business owner who has
  // no password to type — `mode` picks which one is showing, `phoneStep`
  // tracks progress through the phone door's own two steps.
  const [mode, setMode] = useState<'password' | 'phone'>('password');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [phoneStep, setPhoneStep] = useState<PhoneStep>('phone');
  const [phoneError, setPhoneError] = useState<string | null>(null);

  // The bootstrap refresh (AuthProvider, on mount) may still resolve this tab
  // as already authenticated — do not flash the form while that is pending,
  // and do not show it at all once it lands.
  if (status === 'loading') {
    return (
      <main className={styles.loadingPage}>
        <LoadingState label={t('common.loading')} />
      </main>
    );
  }
  if (status === 'authenticated') {
    return <Navigate to={from} replace />;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch {
      // The server answers every rejected login alike on purpose (wrong
      // password and unknown email read the same) — showing its message
      // verbatim would also leak untranslated English into a Hebrew page.
      setError(t('auth.invalidCredentials'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSendCode(event: FormEvent) {
    event.preventDefault();
    setPhoneError(null);
    setPhoneStep('sendingCode');
    const result = await requestSignInOtp(phone);
    if (result.outcome === 'ok') {
      setCode('');
      setPhoneStep('code');
    } else if (result.outcome === 'rate_limited') {
      setPhoneError(t('auth.otpRateLimitedError'));
      setPhoneStep('phone');
    } else {
      // 'network_error' and 'unexpected_error' both land here — `otp/request`
      // never distinguishes an unknown phone from a registered one (see
      // `services/auth.py::request_login_otp`), so a caller who mistyped
      // their number sees exactly the same generic retry as a real outage.
      setPhoneError(t('auth.otpNetworkError'));
      setPhoneStep('phone');
    }
  }

  async function handleVerifyCode(event: FormEvent) {
    event.preventDefault();
    setPhoneError(null);
    setPhoneStep('verifying');
    try {
      await loginWithOtp(phone, code);
      navigate(from, { replace: true });
    } catch (err) {
      setPhoneStep('code');
      if (err instanceof AuthApiError && err.status === 429) setPhoneError(t('auth.otpRateLimitedError'));
      else if (err instanceof AuthApiError && err.status === 401) setPhoneError(t('auth.invalidCodeError'));
      else setPhoneError(t('auth.otpNetworkError'));
    }
  }

  function switchMode(next: 'password' | 'phone') {
    setMode(next);
    setError(null);
    setPhoneError(null);
    setPhone('');
    setCode('');
    setPhoneStep('phone');
  }

  const sendingCode = phoneStep === 'sendingCode';
  const verifyingCode = phoneStep === 'verifying';

  return (
    <AuthSplitLayout heroTitle={t('auth.heroTitle')} heroSubtitle={t('auth.heroSubtitle')}>
      <Heading level={1}>{t('auth.signInTitle')}</Heading>
      <Text variant="body" className={styles.subtitle}>
        {t('auth.signInSubtitle')}
      </Text>
      {mode === 'password' ? (
        <form onSubmit={handleSubmit} noValidate>
          <Input
            label={t('auth.emailLabel')}
            type="email"
            name="email"
            dir="ltr"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <Input
            label={t('auth.passwordLabel')}
            type="password"
            name="password"
            dir="ltr"
            autoComplete="current-password"
            required
            revealPasswordLabel={t('auth.showPasswordLabel')}
            hidePasswordLabel={t('auth.hidePasswordLabel')}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {error && <ErrorState title={error} />}
          <Button type="submit" disabled={submitting} style={{ marginTop: 'var(--space-md)' }}>
            {submitting ? t('auth.signingIn') : t('auth.signInButton')}
          </Button>
        </form>
      ) : phoneStep === 'phone' || phoneStep === 'sendingCode' ? (
        <form onSubmit={handleSendCode} noValidate>
          <Input
            label={t('auth.phoneLabel')}
            type="tel"
            dir="ltr"
            autoComplete="tel"
            required
            pattern={PHONE_PATTERN}
            title={t('auth.phoneFormatError')}
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
          {phoneError && <ErrorState title={phoneError} />}
          <Button type="submit" disabled={sendingCode} style={{ marginTop: 'var(--space-md)' }}>
            {sendingCode ? t('auth.sendingCodeLabel') : t('auth.sendCodeButton')}
          </Button>
        </form>
      ) : (
        <form onSubmit={handleVerifyCode} noValidate>
          <Text variant="body">
            {t('auth.otpSubtitle')} <span dir="ltr">{phone}</span>
          </Text>
          <Input
            label={t('auth.codeLabel')}
            inputMode="numeric"
            dir="ltr"
            autoComplete="one-time-code"
            required
            className={styles.otpInput}
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          {phoneError && <ErrorState title={phoneError} />}
          <Button type="submit" disabled={verifyingCode} style={{ marginTop: 'var(--space-md)' }}>
            {verifyingCode ? t('auth.verifyingLabel') : t('auth.verifyButton')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={verifyingCode}
            onClick={handleSendCode}
            style={{ marginTop: 'var(--space-sm)' }}
          >
            {t('auth.resendButton')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={verifyingCode}
            onClick={() => setPhoneStep('phone')}
            style={{ marginTop: 'var(--space-sm)' }}
          >
            {t('auth.changePhoneButton')}
          </Button>
        </form>
      )}
      <Button
        type="button"
        variant="secondary"
        onClick={() => switchMode(mode === 'password' ? 'phone' : 'password')}
        style={{ marginTop: 'var(--space-md)' }}
      >
        {t(mode === 'password' ? 'auth.signInWithPhoneLink' : 'auth.signInWithEmailLink')}
      </Button>
      {/* CAR-118 review item 5: a recipient who was only given a code (read
          aloud, not clicked) has no production path to `/accept-invite`
          without this — the entry form itself never appears in any nav. */}
      <Link to="/accept-invite" style={{ display: 'block', marginTop: 'var(--space-md)' }}>
        {t('invitations.haveCodeLinkLabel')}
      </Link>
      {/* CAR-315: sign-in is the only public page most prospective business
          owners ever land on — without this, /register has no discoverable
          entry point at all. */}
      <Link to="/register" style={{ display: 'block', marginTop: 'var(--space-md)' }}>
        {t('businessRegistration.signInEntryLabel')}
      </Link>
      <Link to="/register/status" style={{ display: 'block', marginTop: 'var(--space-sm)' }}>
        {t('businessRegistration.checkStatusLink')}
      </Link>
    </AuthSplitLayout>
  );
}
