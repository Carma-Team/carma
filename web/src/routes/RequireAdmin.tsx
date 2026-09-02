import { Outlet } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { ErrorState } from '@/components/ui';

// CAR-255: gates the admin business-requests review page. This is UX only —
// `CurrentAdmin` in server/app/core/deps.py re-resolves ADMIN from the DB row
// on every request and is the actual boundary; a JWT claiming ADMIN with a
// stale role change still gets 403 from the API regardless of what this
// renders. Reads `user.role`, never `businessMembershipRole` — ADMIN is a
// system role, unrelated to any business membership (see `AuthUser`), so
// `RequireBusinessRole` is the wrong guard for this route.
export function RequireAdmin() {
  const { user } = useAuth();
  const { t } = useTranslation();

  if (user?.role !== 'ADMIN') {
    return (
      <div style={{ padding: 'var(--space-lg)' }}>
        <ErrorState title={t('common.accessRestrictedTitle')} message={t('common.accessRestrictedMessage')} />
      </div>
    );
  }

  return <Outlet />;
}
