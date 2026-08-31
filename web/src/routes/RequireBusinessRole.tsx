import { Outlet } from 'react-router-dom';
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
    return (
      <div style={{ padding: 'var(--space-lg)' }}>
        <ErrorState title={t('common.accessRestrictedTitle')} message={t('common.accessRestrictedMessage')} />
      </div>
    );
  }

  return <Outlet />;
}
