import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { AuthApiError } from '@/lib/auth/authApi';
import { Card, Heading, Input, Button, ErrorState, LoadingState } from '@/components/ui';

type LocationState = { from?: string } | null;

// A recipient without an existing CARMA account needs somewhere to create
// one mid-invitation-acceptance (CAR-118) — `/register` is already taken by
// CAR-203's business join-request form, an unrelated flow that never creates
// a user. This wraps the same `/api/auth/register` mobile's sign-up uses.
export function CreateAccountPage() {
  const { t } = useTranslation();
  const { register, status } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as LocationState)?.from ?? '/';
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
      await register(name, email, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(
        err instanceof AuthApiError && err.status === 409
          ? t('auth.emailAlreadyRegisteredError')
          : t('auth.createAccountGenericError'),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-lg)' }}>
      <Card style={{ maxWidth: '24rem', width: '100%' }}>
        <Heading level={1}>{t('auth.createAccountTitle')}</Heading>
        <form onSubmit={handleSubmit} noValidate>
          <Input
            label={t('auth.nameLabel')}
            type="text"
            name="name"
            autoComplete="name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Input
            label={t('auth.emailLabel')}
            type="email"
            name="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <Input
            label={t('auth.passwordLabel')}
            type="password"
            name="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {error && <ErrorState title={error} />}
          <Button type="submit" disabled={submitting} style={{ marginTop: 'var(--space-md)' }}>
            {submitting ? t('auth.creatingAccountLabel') : t('auth.createAccountButton')}
          </Button>
        </form>
      </Card>
    </main>
  );
}
