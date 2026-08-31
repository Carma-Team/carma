import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { Card, Heading, Input, Button, ErrorState, LoadingState } from '@/components/ui';

// The page a caller was on before being sent here — e.g. an invitation-accept
// link (CAR-118) for a signed-out recipient. Carried as router state, never a
// query param: state lives only in memory/history, not the URL, so it never
// reaches server logs, analytics, or a browser's address bar autocomplete.
type LocationState = { from?: string } | null;

export function SignInPage() {
  const { t } = useTranslation();
  const { login, status } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as LocationState)?.from ?? '/';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // The bootstrap refresh (AuthProvider, on mount) may still resolve this tab
  // as already authenticated — do not flash the form while that is pending,
  // and do not show it at all once it lands.
  if (status === 'loading') {
    return (
      <main style={{ padding: 'var(--space-lg)' }}>
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

  return (
    <main style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-lg)' }}>
      <Card style={{ maxWidth: '24rem', width: '100%' }}>
        <Heading level={1}>{t('auth.signInTitle')}</Heading>
        <form onSubmit={handleSubmit} noValidate>
          <Input
            label={t('auth.emailLabel')}
            type="email"
            name="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <Input
            label={t('auth.passwordLabel')}
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {error && <ErrorState title={error} />}
          <Button type="submit" disabled={submitting} style={{ marginTop: 'var(--space-md)' }}>
            {submitting ? t('auth.signingIn') : t('auth.signInButton')}
          </Button>
        </form>
        {/* CAR-118 review item 5: a recipient who was only given a code (read
            aloud, not clicked) has no production path to `/accept-invite`
            without this — the entry form itself never appears in any nav. */}
        <Link to="/accept-invite" style={{ display: 'block', marginTop: 'var(--space-md)' }}>
          {t('invitations.haveCodeLinkLabel')}
        </Link>
      </Card>
    </main>
  );
}
