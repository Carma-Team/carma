import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { LoadingState } from '@/components/ui';

// Guards every route nested under it: unauthenticated renders nowhere near an
// authenticated page, it redirects before one ever mounts. 'loading' — the
// bootstrap refresh from AuthProvider has not settled yet — renders neither,
// rather than guessing which one a reload will turn out to be.
export function ProtectedRoute() {
  const { status } = useAuth();
  const { t } = useTranslation();

  if (status === 'loading') {
    return (
      <main style={{ padding: 'var(--space-lg)' }}>
        <LoadingState label={t('common.loading')} />
      </main>
    );
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/sign-in" replace />;
  }

  return <Outlet />;
}
