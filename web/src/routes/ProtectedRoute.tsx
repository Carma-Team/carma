import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { LoadingState, ErrorState } from '@/components/ui';

// Guards every route nested under it: unauthenticated renders nowhere near an
// authenticated page, it redirects before one ever mounts. 'loading' — the
// bootstrap refresh from AuthProvider has not settled yet — renders neither,
// rather than guessing which one a reload will turn out to be. 'error' — the
// bootstrap check couldn't get a real answer (network/timeout/429/5xx, see
// `lib/auth/refresh.ts`) — renders neither either, but offers a retry instead
// of the sign-in redirect: nothing said this session is invalid, so nothing
// here should throw it away.
export function ProtectedRoute() {
  const { status, retry } = useAuth();
  const { t } = useTranslation();

  if (status === 'loading') {
    return (
      <main style={{ padding: 'var(--space-lg)' }}>
        <LoadingState label={t('common.loading')} />
      </main>
    );
  }

  if (status === 'error') {
    return (
      <main style={{ padding: 'var(--space-lg)' }}>
        <ErrorState
          title={t('common.errorTitle')}
          message={t('common.errorMessage')}
          onRetry={retry}
          retryLabel={t('common.retry')}
        />
      </main>
    );
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/sign-in" replace />;
  }

  return <Outlet />;
}
