import { Link, Outlet } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { ErrorState } from '@/components/ui';
import { hasBusinessRole, type BusinessMembershipRole } from '@/lib/auth/businessRole';

// Presentation-only (CAR-202): the server independently rejects the same
// roles on every mutating reward endpoint via `CurrentBusinessManager`
// (server/app/core/deps.py) — this only spares a CASHIER (or a null/ambiguous
// membership, see AuthUser) the round trip of finding that out by clicking
// something. `businessMembershipRole` is read from `useAuth()`, never
// decoded from the JWT — CAR-258's DB-resolved value is the only source of
// truth for OWNER/MANAGER/CASHIER. Generic on purpose: CAR-116 reuses this
// both for OWNER/MANAGER-only routes and, with all three roles in `allow`,
// as the blanket "a real membership role exists" gate for the whole
// authenticated business area — a null or ambiguous membership fails closed
// the same way an out-of-scope role does.
export function RequireBusinessRole({ allow }: { allow: BusinessMembershipRole[] }) {
  const { user } = useAuth();
  const { t } = useTranslation();

  if (!hasBusinessRole(user?.businessMembershipRole, allow)) {
    // An account with no business membership at all — never one that
    // already belongs somewhere, which the accept flow's own server-side
    // check refuses regardless — may simply have been told an invitation
    // code rather than sent the link (CAR-118 review's manual-code
    // discoverability gap): this is the one dead end in the app such an
    // account could otherwise land on with no way forward.
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

  return <Outlet />;
}
