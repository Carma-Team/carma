import { Outlet } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { ErrorState } from '@/components/ui';
import type { AuthUser } from '@/lib/auth/types';

type BusinessMembershipRole = NonNullable<AuthUser['businessMembershipRole']>;

// Presentation-only (CAR-202): the server independently rejects the same
// roles on every mutating reward endpoint via `CurrentBusinessManager`
// (server/app/core/deps.py) — this only spares a CASHIER (or a null/ambiguous
// membership, see AuthUser) the round trip of finding that out by clicking
// something. `businessMembershipRole` is read from `useAuth()`, never
// decoded from the JWT — CAR-258's DB-resolved value is the only source of
// truth for OWNER/MANAGER/CASHIER. Generic on purpose: CAR-116 (the full
// navigation/landing matrix) can reuse this for whatever else ends up
// OWNER/MANAGER-only rather than inventing a second gate.
export function RequireBusinessRole({ allow }: { allow: BusinessMembershipRole[] }) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const role = user?.businessMembershipRole ?? null;

  if (role === null || !allow.includes(role)) {
    return (
      <div style={{ padding: 'var(--space-lg)' }}>
        <ErrorState title={t('common.accessRestrictedTitle')} message={t('common.accessRestrictedMessage')} />
      </div>
    );
  }

  return <Outlet />;
}
