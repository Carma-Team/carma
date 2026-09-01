import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { ErrorState } from '@/components/ui';
import { hasBusinessRole, normalizeBusinessRole } from '@/lib/auth/businessRole';
import { HomePage } from '@/pages/HomePage';

// `/` sits outside `RequireBusinessRole` on purpose (CAR-255 review): that
// guard only ever resolves OWNER/MANAGER/CASHIER, so an ADMIN — a system
// role with no business membership at all — hit its access-restricted dead
// end before this component ever ran, on the very landing page a fresh
// sign-in sends every role to (see SignInPage's `from` default). This is the
// one route both an ADMIN and a business role can reach, so it does its own
// role check instead, duplicating RequireBusinessRole's access-restricted
// markup the same way RequireAdmin already does rather than sharing it.
export function LandingRoute() {
  const { user } = useAuth();
  const { t } = useTranslation();

  if (user?.role === 'ADMIN') return <Navigate to="/admin/business-requests" replace />;

  if (!hasBusinessRole(user?.businessMembershipRole, ['OWNER', 'MANAGER', 'CASHIER'])) {
    const eligibleForInvitation = user !== null && user.businessMembershipRole == null && !user.businessMembershipAmbiguous;
    return (
      <div style={{ padding: 'var(--space-lg)' }}>
        <ErrorState title={t('common.accessRestrictedTitle')} message={t('common.accessRestrictedMessage')} />
        {eligibleForInvitation && (
          <Link to="/accept-invite" style={{ display: 'block', marginTop: 'var(--space-md)' }}>
            {t('invitations.haveCodeLinkLabel')}
          </Link>
        )}
      </div>
    );
  }

  // CAR-116: a CASHIER's landing page is redemption, not the dashboard they
  // have no other use for. OWNER and MANAGER keep the real HomePage.
  const role = normalizeBusinessRole(user?.businessMembershipRole);
  if (role === 'CASHIER') return <Navigate to="/redemption" replace />;
  return <HomePage />;
}
