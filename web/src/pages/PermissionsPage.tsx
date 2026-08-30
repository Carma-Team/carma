import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/hooks/useAuth';
import { applySelfMembershipChange } from '@/lib/auth/selfMembership';
import {
  changeMemberRole,
  listMembers,
  revokeMemberAccess,
  type BusinessMember,
  type BusinessMembershipRole,
} from '@/lib/api/businessMembers';
import { Card, Heading, Text, Button, Dialog, LoadingState, ErrorState, EmptyState } from '@/components/ui';
import inputStyles from '@/components/ui/Input.module.css';
import styles from './PermissionsPage.module.css';

type LoadStatus = 'loading' | 'ready' | 'error' | 'forbidden';

const ROLES: BusinessMembershipRole[] = ['OWNER', 'MANAGER', 'CASHIER'];

export function PermissionsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [members, setMembers] = useState<BusinessMember[]>([]);
  const [revokeTarget, setRevokeTarget] = useState<BusinessMember | null>(null);
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  // Guards a second mutation from firing while one is already in flight for
  // this page — one at a time, same convention as RewardsPage's
  // retireInFlight (CAR-202's pre-commit review found the interleaving bug
  // that guard exists to prevent).
  const mutationInFlight = useRef(false);

  function applyListResult(result: Awaited<ReturnType<typeof listMembers>>) {
    if (result.outcome === 'ok') {
      setMembers(result.members);
      setStatus('ready');
    } else if (result.outcome === 'forbidden') {
      setStatus('forbidden');
    } else {
      setStatus('error');
    }
  }

  useEffect(() => {
    let cancelled = false;
    listMembers().then((result) => {
      if (!cancelled) applyListResult(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function retry() {
    setStatus('loading');
    listMembers().then(applyListResult);
  }

  function clearRowError(membershipId: string) {
    setRowErrors((prev) => {
      if (!(membershipId in prev)) return prev;
      const rest = { ...prev };
      delete rest[membershipId];
      return rest;
    });
  }

  // Every row's revoke button otherwise shares the same visible text
  // ("Revoke access") — fine visually, but identical accessible names across
  // rows leave a screen-reader user with no way to tell them apart while
  // tabbing through the table. Naming the member closes that gap; the
  // confirm dialog's own action reuses it too, since a person driving by
  // keyboard/screen reader benefits from the same disambiguation there.
  function revokeAriaLabel(member: BusinessMember): string {
    return t('permissions.revokeButtonAriaLabel').replace('{name}', member.name ?? t('permissions.unnamedMemberLabel'));
  }

  // Delegates to the auth layer rather than writing the shared session store
  // directly — see `lib/auth/selfMembership.ts`. It patches
  // `businessMembershipRole` (and, on revoke, the rest of the business
  // context) synchronously from the value this mutation just confirmed
  // server-side, so `AppShell`'s nav link and this route's own
  // `RequireBusinessRole` guard — both reading `useAuth().user` off that
  // same store — render consistently with it on the very next render, then
  // reconciles with the server in the background.
  async function syncSelfIfNeeded(mutatedUserId: string, newRoleForSelf: BusinessMembershipRole | null) {
    if (!user || mutatedUserId !== user.id) return;
    await applySelfMembershipChange(mutatedUserId, newRoleForSelf);
  }

  async function handleRoleChange(member: BusinessMember, role: BusinessMembershipRole) {
    if (mutationInFlight.current || role === member.role) return;
    mutationInFlight.current = true;
    setMutatingId(member.id);
    clearRowError(member.id);

    const result = await changeMemberRole(member.id, role);
    mutationInFlight.current = false;
    setMutatingId(null);

    if (result.outcome === 'ok') {
      setMembers((prev) => prev.map((m) => (m.id === member.id ? result.member : m)));
      await syncSelfIfNeeded(member.userId, result.member.role);
      return;
    }
    setRowErrors((prev) => ({
      ...prev,
      [member.id]: result.outcome === 'last_owner' ? t('permissions.lastOwnerErrorMessage') : t('permissions.roleChangeErrorMessage'),
    }));
  }

  async function handleConfirmRevoke() {
    if (!revokeTarget || mutationInFlight.current) return;
    const target = revokeTarget;
    mutationInFlight.current = true;
    setMutatingId(target.id);
    clearRowError(target.id);

    const result = await revokeMemberAccess(target.id);
    mutationInFlight.current = false;
    setMutatingId(null);
    setRevokeTarget(null);

    if (result.outcome === 'ok') {
      setMembers((prev) => prev.filter((m) => m.id !== target.id));
      // Revoked entirely — no membership role left at all, not just a lower one.
      await syncSelfIfNeeded(target.userId, null);
      return;
    }
    setRowErrors((prev) => ({
      ...prev,
      [target.id]: result.outcome === 'last_owner' ? t('permissions.lastOwnerErrorMessage') : t('permissions.revokeErrorMessage'),
    }));
  }

  if (status === 'loading') {
    return <LoadingState label={t('permissions.loadingLabel')} />;
  }

  if (status === 'forbidden') {
    return <ErrorState title={t('permissions.forbiddenTitle')} message={t('permissions.forbiddenMessage')} />;
  }

  if (status === 'error') {
    return (
      <ErrorState
        title={t('permissions.loadErrorTitle')}
        message={t('permissions.loadErrorMessage')}
        onRetry={retry}
        retryLabel={t('permissions.retryButton')}
      />
    );
  }

  return (
    <div>
      <div className={styles.header}>
        <Heading level={1}>{t('permissions.title')}</Heading>
        <Text variant="body">{t('permissions.subtitle')}</Text>
      </div>

      {members.length === 0 ? (
        <EmptyState title={t('permissions.emptyTitle')} message={t('permissions.emptyMessage')} />
      ) : (
        <Card>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t('permissions.memberColumnLabel')}</th>
                <th>{t('permissions.roleColumnLabel')}</th>
                <th>{t('permissions.actionsColumnLabel')}</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const isSelf = user?.id === member.userId;
                const busy = mutatingId === member.id;
                return (
                  <tr key={member.id}>
                    <td>
                      <div className={styles.memberCell}>
                        <Text variant="label" as="span">
                          {member.name ?? t('permissions.unnamedMemberLabel')}
                        </Text>
                        {isSelf && <span className={styles.selfBadge}>{t('permissions.youBadge')}</span>}
                      </div>
                      {member.email && (
                        <Text variant="caption" dir="ltr">
                          {member.email}
                        </Text>
                      )}
                      <Text variant="caption">{t(`permissions.roleDescription${roleKey(member.role)}`)}</Text>
                    </td>
                    <td>
                      <select
                        className={inputStyles.input}
                        aria-label={t('permissions.roleColumnLabel')}
                        value={member.role}
                        disabled={mutatingId !== null}
                        onChange={(event) => handleRoleChange(member, event.target.value as BusinessMembershipRole)}
                      >
                        {ROLES.map((role) => (
                          <option key={role} value={role}>
                            {t(`permissions.roleLabel${roleKey(role)}`)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <Button
                        variant="danger"
                        aria-label={revokeAriaLabel(member)}
                        disabled={mutatingId !== null}
                        onClick={() => setRevokeTarget(member)}
                      >
                        {busy ? t('permissions.revokingLabel') : t('permissions.revokeButton')}
                      </Button>
                      {rowErrors[member.id] && (
                        <Text variant="caption" role="alert">
                          {rowErrors[member.id]}
                        </Text>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      <Dialog
        open={revokeTarget !== null}
        onClose={() => {
          if (mutationInFlight.current) return;
          setRevokeTarget(null);
        }}
        title={t('permissions.revokeConfirmTitle')}
        closeLabel={t('permissions.revokeConfirmCloseLabel')}
      >
        <Text variant="body">{t('permissions.revokeConfirmBody')}</Text>
        <div className={styles.actions}>
          <Button
            variant="danger"
            aria-label={revokeTarget ? revokeAriaLabel(revokeTarget) : undefined}
            disabled={mutatingId !== null}
            onClick={handleConfirmRevoke}
          >
            {t('permissions.revokeConfirmYes')}
          </Button>
          <Button variant="secondary" disabled={mutatingId !== null} onClick={() => setRevokeTarget(null)}>
            {t('permissions.revokeConfirmCancel')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function roleKey(role: BusinessMembershipRole): 'Owner' | 'Manager' | 'Cashier' {
  if (role === 'OWNER') return 'Owner';
  if (role === 'MANAGER') return 'Manager';
  return 'Cashier';
}
