import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { attemptRefresh } from '@/lib/auth/refresh';
import { getSession } from '@/lib/auth/session';
import { acceptInvitation, previewInvitation, type InvitationPreview } from '@/lib/api/businessInvitations';
import { Card, Heading, Text, Button, ErrorState, LoadingState } from '@/components/ui';
import styles from './AcceptInvitationPage.module.css';

type PreviewStatus = 'loading' | 'ok' | 'invalid' | 'error';
// 'ambiguous' and 'reconcile_*' are only reachable after the server has
// already confirmed acceptance — the membership exists from this point on,
// no matter which of these three the session reconciliation lands on.
type AcceptPhase =
  | 'idle'
  | 'accepting'
  | 'error'
  | 'already_member'
  | 'ambiguous'
  | 'reconcile_rejected'
  | 'reconcile_transient';

function roleKey(role: InvitationPreview['role']): 'Manager' | 'Cashier' {
  return role === 'manager' ? 'Manager' : 'Cashier';
}

// The recipient side of CAR-118 — reachable at the exact link shape
// `services/business_invitations.py::_link` generates
// (`{invite_base_url}/business-invite/{token}`), and also from a manually
// typed code via `AcceptInvitationEntryPage`. Sits outside `ProtectedRoute`
// on purpose: an unauthenticated recipient must be able to land here at all,
// see the invitation is theirs, and only then be sent to sign in or register
// — never the reverse order, which would mean redirecting before the
// recipient has any idea what they were invited to.
export function AcceptInvitationPage() {
  const { token = '' } = useParams<{ token: string }>();
  const { t } = useTranslation();
  const { status, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>('loading');
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [acceptPhase, setAcceptPhase] = useState<AcceptPhase>('idle');
  const [reconciling, setReconciling] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const acceptInFlight = useRef(false);
  // Set once the server has confirmed acceptance — never cleared, and never
  // re-read to decide whether to call `acceptInvitation` again. Its only job
  // is remembering which business this accepted invitation named, so the
  // reconciliation check below has something to compare the refreshed
  // session against.
  const acceptedBusinessId = useRef<string | null>(null);

  useEffect(() => {
    if (status !== 'authenticated') return;
    let cancelled = false;
    previewInvitation(token).then((result) => {
      if (cancelled) return;
      if (result.outcome === 'ok') {
        setPreview(result.invitation);
        setPreviewStatus('ok');
      } else if (result.outcome === 'invalid') {
        setPreviewStatus('invalid');
      } else {
        setPreviewStatus('error');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [status, token, retryCount]);

  function retryPreview() {
    setPreviewStatus('loading');
    setRetryCount((count) => count + 1);
  }

  async function handleAccept() {
    if (acceptInFlight.current) return;
    acceptInFlight.current = true;
    setAcceptPhase('accepting');

    const result = await acceptInvitation(token);
    acceptInFlight.current = false;

    if (result.outcome === 'ok') {
      acceptedBusinessId.current = result.membership.businessId;
      await reconcileAfterAccept();
      return;
    }

    if (result.outcome === 'already_member') {
      setAcceptPhase('already_member');
      return;
    }
    if (result.outcome === 'invalid') {
      setPreviewStatus('invalid');
      setAcceptPhase('idle');
      return;
    }
    setAcceptPhase('error');
  }

  // Server-authoritative reconciliation (CAR-118): the membership this
  // invitation granted was already created in the database by the time this
  // runs, so the session is refreshed from there rather than assembled
  // client-side — the client never decides its own role or business
  // identity. Split out from `handleAccept` so the "Retry" action on a
  // transient reconciliation failure below can re-run only this half —
  // `acceptInvitation` must never be called a second time for a token the
  // server has already consumed.
  async function reconcileAfterAccept() {
    setReconciling(true);
    const outcome = await attemptRefresh();
    setReconciling(false);

    if (outcome !== 'ok') {
      // Neither of these means the acceptance failed — the membership is
      // already committed server-side. 'rejected' is a genuinely dead
      // session (the refresh cookie is gone); 'transient' is a network/5xx
      // blip that says nothing about session validity either way (see
      // `lib/auth/refresh.ts`) — both get a distinct message from an actual
      // accept failure, and neither offers to redeem the token again.
      setAcceptPhase(outcome === 'rejected' ? 'reconcile_rejected' : 'reconcile_transient');
      return;
    }

    const user = getSession()?.user;
    // Fails closed the same way CAR-258's own server contract does: no
    // membership role, or a role that resolved to some business other than
    // the one this invitation named, both mean the account cannot be placed
    // into a single unambiguous business context. Business-context
    // selection is explicitly out of scope here (CAR-258) and nowhere else
    // in this app either, so this is a terminal state, not a retryable one.
    if (!user || user.businessMembershipAmbiguous || !user.businessMembershipRole || user.businessId !== acceptedBusinessId.current) {
      setAcceptPhase('ambiguous');
      return;
    }
    navigate('/', { replace: true });
  }

  async function handleSignOutAfterAmbiguousAcceptance() {
    await logout();
    navigate('/sign-in', { replace: true });
  }

  // These four are all reachable only after the server has already confirmed
  // acceptance (or, for 'already_member', after confirming the membership
  // already existed) — checked ahead of `status` on purpose. A 'rejected'
  // reconciliation clears the session as a side effect (`applyRefreshRejection`
  // in `lib/auth/session.ts`), which flips `status` to 'unauthenticated' the
  // moment it happens; without this ordering that flip would replace this
  // outcome with the generic sign-in-or-register choice screen below, losing
  // the fact that the invitation was already, successfully consumed.
  if (acceptPhase === 'already_member') {
    return (
      <main className={styles.page}>
        <Card className={styles.card}>
          <Heading level={1}>{t('invitations.alreadyMemberTitle')}</Heading>
          <Text variant="body">{t('invitations.alreadyMemberMessage')}</Text>
          <Button onClick={() => navigate('/', { replace: true })}>{t('invitations.goToBusinessButton')}</Button>
        </Card>
      </main>
    );
  }

  if (acceptPhase === 'ambiguous') {
    return (
      <main className={styles.page}>
        <Card className={styles.card}>
          <Heading level={1}>{t('invitations.ambiguousTitle')}</Heading>
          <Text variant="body">{t('invitations.ambiguousMessage')}</Text>
          <Button onClick={handleSignOutAfterAmbiguousAcceptance}>{t('invitations.ambiguousSignOutButton')}</Button>
        </Card>
      </main>
    );
  }

  if (acceptPhase === 'reconcile_rejected') {
    return (
      <main className={styles.page}>
        <Card className={styles.card}>
          <Heading level={1}>{t('invitations.reconcileRejectedTitle')}</Heading>
          <Text variant="body">{t('invitations.reconcileRejectedMessage')}</Text>
          <Button onClick={() => navigate('/sign-in', { replace: true })}>{t('invitations.signInLinkLabel')}</Button>
        </Card>
      </main>
    );
  }

  if (acceptPhase === 'reconcile_transient') {
    return (
      <main className={styles.page}>
        <Card className={styles.card}>
          <Heading level={1}>{t('invitations.reconcileTransientTitle')}</Heading>
          <Text variant="body">{t('invitations.reconcileTransientMessage')}</Text>
          <Button onClick={reconcileAfterAccept} disabled={reconciling}>
            {reconciling ? t('invitations.reconcilingLabel') : t('invitations.reconcileRetryButton')}
          </Button>
        </Card>
      </main>
    );
  }

  if (status === 'loading') {
    return (
      <main className={styles.page}>
        <LoadingState label={t('common.loading')} />
      </main>
    );
  }

  if (status === 'unauthenticated' || status === 'error') {
    // The token stays in the URL path, carried further only as router state
    // (never a query param or storage) so the recipient lands back here —
    // and only here — once signed in or registered.
    const from = location.pathname;
    return (
      <main className={styles.page}>
        <Card className={styles.card}>
          <Heading level={1}>{t('invitations.acceptPageTitleUnauthenticated')}</Heading>
          <div className={styles.choiceRow}>
            <Text variant="body">{t('invitations.signInPrompt')}</Text>
            <Button variant="secondary" onClick={() => navigate('/sign-in', { state: { from } })}>
              {t('invitations.signInLinkLabel')}
            </Button>
          </div>
          <div className={styles.choiceRow}>
            <Text variant="body">{t('invitations.createAccountPrompt')}</Text>
            <Button onClick={() => navigate('/create-account', { state: { from } })}>
              {t('invitations.createAccountLinkLabel')}
            </Button>
          </div>
        </Card>
      </main>
    );
  }

  if (previewStatus === 'loading') {
    return (
      <main className={styles.page}>
        <LoadingState label={t('invitations.loadingPreviewLabel')} />
      </main>
    );
  }

  if (previewStatus === 'invalid') {
    return (
      <main className={styles.page}>
        <ErrorState title={t('invitations.invalidTitle')} message={t('invitations.invalidMessage')} />
      </main>
    );
  }

  if (previewStatus === 'error' || !preview) {
    return (
      <main className={styles.page}>
        <ErrorState
          title={t('common.errorTitle')}
          message={t('common.errorMessage')}
          onRetry={retryPreview}
          retryLabel={t('common.retry')}
        />
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <Card className={styles.card}>
        <Heading level={1}>{t('invitations.acceptPageTitle')}</Heading>
        <Text variant="label" as="span">
          {t('invitations.previewBusinessLabel')}
        </Text>
        <Text variant="body">{preview.businessName}</Text>
        <Text variant="label" as="span">
          {t('invitations.previewRoleLabel')}
        </Text>
        <Text variant="body">{t(`permissions.roleLabel${roleKey(preview.role)}`)}</Text>

        {acceptPhase === 'error' && (
          <Text variant="caption" role="alert">
            {t('invitations.acceptErrorMessage')}
          </Text>
        )}

        <Button onClick={handleAccept} disabled={acceptPhase === 'accepting'}>
          {acceptPhase === 'accepting' ? t('invitations.acceptingLabel') : t('invitations.acceptButton')}
        </Button>
      </Card>
    </main>
  );
}
