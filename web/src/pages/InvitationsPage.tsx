import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from '@/hooks/useTranslation';
import {
  createInvitation,
  listInvitations,
  revokeInvitation,
  type CreatedInvitation,
  type InvitationRole,
  type PendingInvitation,
} from '@/lib/api/businessInvitations';
import { Card, Heading, Text, Button, Dialog, LoadingState, ErrorState, EmptyState } from '@/components/ui';
import inputStyles from '@/components/ui/Input.module.css';
import styles from './InvitationsPage.module.css';

type LoadStatus = 'loading' | 'ready' | 'error' | 'forbidden';
type CopiedField = 'link' | 'code' | null;

const ROLES: InvitationRole[] = ['manager', 'cashier'];

function roleKey(role: InvitationRole): 'Manager' | 'Cashier' {
  return role === 'manager' ? 'Manager' : 'Cashier';
}

// YYYY-MM-DD, not a locale-formatted string — this only feeds an aria-label
// disambiguating otherwise-identical revoke buttons, so it needs to be
// concise and stable, not pretty.
function isoDate(value: string): string {
  return value.slice(0, 10);
}

export function InvitationsPage() {
  const { t } = useTranslation();
  const [listStatus, setListStatus] = useState<LoadStatus>('loading');
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [selectedRole, setSelectedRole] = useState<InvitationRole>('manager');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedInvitation | null>(null);
  const [copied, setCopied] = useState<CopiedField>(null);
  const [revokeTarget, setRevokeTarget] = useState<PendingInvitation | null>(null);
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  // A page-level, non-row notice — the row it was about no longer exists in
  // the list by the time this fires (see the 'already_redeemed' branch of
  // `handleConfirmRevoke`), so it can't be attached to a row the way
  // `rowErrors` is.
  const [staleNotice, setStaleNotice] = useState<string | null>(null);
  // Two independent guards — creating a new invitation and revoking an
  // existing one are unrelated actions and must each refuse only their own
  // repeat submission, not each other's.
  const createInFlight = useRef(false);
  const mutationInFlight = useRef(false);
  const copiedTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  function applyListResult(result: Awaited<ReturnType<typeof listInvitations>>) {
    if (result.outcome === 'ok') {
      setInvitations(result.invitations);
      setListStatus('ready');
    } else if (result.outcome === 'forbidden') {
      setListStatus('forbidden');
    } else {
      setListStatus('error');
    }
  }

  useEffect(() => {
    let cancelled = false;
    listInvitations().then((result) => {
      if (!cancelled) applyListResult(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (copiedTimeout.current) clearTimeout(copiedTimeout.current);
    };
  }, []);

  function retry() {
    setListStatus('loading');
    setStaleNotice(null);
    listInvitations().then(applyListResult);
  }

  async function handleCreate() {
    // `created !== null` here, not only on the button/select `disabled`
    // attribute those read from the same state: a displayed one-time
    // credential must never be replaced by a second create, even if this is
    // reached some way other than a click on the (visibly disabled) trigger.
    if (createInFlight.current || created !== null) return;
    createInFlight.current = true;
    setCreating(true);
    setCreateError(null);

    const result = await createInvitation(selectedRole);
    createInFlight.current = false;
    setCreating(false);

    if (result.outcome === 'ok') {
      setCreated(result.invitation);
      return;
    }
    setCreateError(t('invitations.createErrorMessage'));
  }

  async function copyToClipboard(field: CopiedField, value: string) {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // A clipboard write can fail (permissions, insecure context) — the
      // link/code text is still visible and selectable on the page, so this
      // is a degraded convenience, not a broken flow.
      return;
    }
    setCopied(field);
    if (copiedTimeout.current) clearTimeout(copiedTimeout.current);
    copiedTimeout.current = setTimeout(() => setCopied(null), 2000);
  }

  function handleDoneWithCreated() {
    setCreated(null);
    setCopied(null);
    retry();
  }

  function clearRowError(invitationId: string) {
    setRowErrors((prev) => {
      if (!(invitationId in prev)) return prev;
      const rest = { ...prev };
      delete rest[invitationId];
      return rest;
    });
  }

  function revokeAriaLabel(invitation: PendingInvitation): string {
    return t('invitations.revokeButtonAriaLabel')
      .replace('{role}', t(`permissions.roleLabel${roleKey(invitation.role)}`))
      .replace('{date}', isoDate(invitation.expiresAt));
  }

  async function handleConfirmRevoke() {
    if (!revokeTarget || mutationInFlight.current) return;
    const target = revokeTarget;
    mutationInFlight.current = true;
    setMutatingId(target.id);
    clearRowError(target.id);
    setStaleNotice(null);

    const result = await revokeInvitation(target.id);
    mutationInFlight.current = false;
    setMutatingId(null);
    setRevokeTarget(null);

    if (result.outcome === 'ok' || result.outcome === 'not_found') {
      // Already gone is the caller's goal either way — a second click while
      // a first request is still in flight must not surface as an error.
      setInvitations((prev) => prev.filter((i) => i.id !== target.id));
      return;
    }
    if (result.outcome === 'already_redeemed') {
      // The recipient redeemed it a moment before this revoke reached the
      // server — the row was stale, not the revoke action wrong. Reconcile
      // the list to match (it is no longer pending either way) and say so
      // plainly, rather than the generic error, which would invite retrying
      // a revoke that can never succeed against an already-redeemed row.
      setInvitations((prev) => prev.filter((i) => i.id !== target.id));
      setStaleNotice(t('invitations.revokeAlreadyRedeemedMessage'));
      return;
    }
    setRowErrors((prev) => ({ ...prev, [target.id]: t('invitations.revokeErrorMessage') }));
  }

  return (
    <div>
      <div className={styles.header}>
        <Heading level={1}>{t('invitations.title')}</Heading>
        <Text variant="body">{t('invitations.subtitle')}</Text>
      </div>

      <Card className={styles.createCard}>
        <Heading level={2}>{t('invitations.createSectionTitle')}</Heading>
        <div className={styles.createRow}>
          <select
            className={inputStyles.input}
            aria-label={t('invitations.roleSelectLabel')}
            value={selectedRole}
            disabled={creating || created !== null}
            onChange={(event) => setSelectedRole(event.target.value as InvitationRole)}
          >
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {t(`permissions.roleLabel${roleKey(role)}`)}
              </option>
            ))}
          </select>
          {/* Disabled for as long as `created` holds a just-created
              invitation, not only while `creating` is in flight — its link
              and token are shown exactly once (see
              `BusinessInvitationOut`'s own docstring server-side) and are
              gone for good once replaced, so a second create must wait for
              the OWNER to explicitly dismiss the first via the dialog's
              "Done" action before it can run at all. */}
          <Button onClick={handleCreate} disabled={creating || created !== null}>
            {creating ? t('invitations.creatingLabel') : t('invitations.createButton')}
          </Button>
        </div>
        {createError && (
          <Text variant="caption" role="alert">
            {createError}
          </Text>
        )}
      </Card>

      {listStatus === 'loading' && <LoadingState label={t('invitations.pendingLoadingLabel')} />}

      {listStatus === 'forbidden' && (
        <ErrorState title={t('invitations.forbiddenTitle')} message={t('invitations.forbiddenMessage')} />
      )}

      {listStatus === 'error' && (
        <ErrorState
          title={t('invitations.pendingLoadErrorTitle')}
          message={t('invitations.pendingLoadErrorMessage')}
          onRetry={retry}
          retryLabel={t('invitations.pendingRetryButton')}
        />
      )}

      {listStatus === 'ready' && (
        <div className={styles.pendingSection}>
          <Heading level={2}>{t('invitations.pendingListTitle')}</Heading>
          {staleNotice && (
            <Text variant="caption" role="status">
              {staleNotice}
            </Text>
          )}
          {invitations.length === 0 ? (
            <EmptyState title={t('invitations.pendingEmptyTitle')} message={t('invitations.pendingEmptyMessage')} />
          ) : (
            <Card>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>{t('invitations.roleColumnLabel')}</th>
                    <th>{t('invitations.expiresColumnLabel')}</th>
                    <th>{t('invitations.actionsColumnLabel')}</th>
                  </tr>
                </thead>
                <tbody>
                  {invitations.map((invitation) => {
                    const busy = mutatingId === invitation.id;
                    return (
                      <tr key={invitation.id}>
                        <td>
                          <Text variant="label" as="span">
                            {t(`permissions.roleLabel${roleKey(invitation.role)}`)}
                          </Text>
                        </td>
                        <td>
                          <Text variant="body" as="span">
                            {new Date(invitation.expiresAt).toLocaleString()}
                          </Text>
                        </td>
                        <td>
                          <Button
                            variant="danger"
                            aria-label={revokeAriaLabel(invitation)}
                            disabled={mutatingId !== null}
                            onClick={() => setRevokeTarget(invitation)}
                          >
                            {busy ? t('invitations.revokingLabel') : t('invitations.revokeButton')}
                          </Button>
                          {rowErrors[invitation.id] && (
                            <Text variant="caption" role="alert">
                              {rowErrors[invitation.id]}
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
        </div>
      )}

      <Dialog
        open={created !== null}
        onClose={handleDoneWithCreated}
        title={t('invitations.createButton')}
        closeLabel={t('invitations.doneButton')}
      >
        {created && (
          <div className={styles.createdPanel}>
            <Text variant="body">{t('invitations.validityNotice')}</Text>

            <div className={styles.field}>
              <Text variant="label" as="span">
                {t('invitations.linkLabel')}
              </Text>
              <div className={styles.copyRow}>
                <input className={inputStyles.input} dir="ltr" readOnly value={created.url} />
                <Button variant="secondary" onClick={() => copyToClipboard('link', created.url)}>
                  {copied === 'link' ? t('invitations.copiedLabel') : t('invitations.copyLinkButton')}
                </Button>
              </div>
            </div>

            <div className={styles.field}>
              <Text variant="label" as="span">
                {t('invitations.codeLabel')}
              </Text>
              <div className={styles.copyRow}>
                <input className={inputStyles.input} dir="ltr" readOnly value={created.token} />
                <Button variant="secondary" onClick={() => copyToClipboard('code', created.token)}>
                  {copied === 'code' ? t('invitations.copiedLabel') : t('invitations.copyCodeButton')}
                </Button>
              </div>
            </div>

            <Button onClick={handleDoneWithCreated}>{t('invitations.doneButton')}</Button>
          </div>
        )}
      </Dialog>

      <Dialog
        open={revokeTarget !== null}
        onClose={() => {
          if (mutationInFlight.current) return;
          setRevokeTarget(null);
        }}
        title={t('invitations.revokeConfirmTitle')}
        closeLabel={t('invitations.revokeConfirmCloseLabel')}
      >
        <Text variant="body">{t('invitations.revokeConfirmBody')}</Text>
        <div className={styles.actions}>
          <Button
            variant="danger"
            aria-label={revokeTarget ? revokeAriaLabel(revokeTarget) : undefined}
            disabled={mutatingId !== null}
            onClick={handleConfirmRevoke}
          >
            {t('invitations.revokeConfirmYes')}
          </Button>
          <Button variant="secondary" disabled={mutatingId !== null} onClick={() => setRevokeTarget(null)}>
            {t('invitations.revokeConfirmCancel')}
          </Button>
        </div>
      </Dialog>

      <Link to="/permissions" className={styles.backLink}>
        {t('permissions.title')}
      </Link>
    </div>
  );
}
