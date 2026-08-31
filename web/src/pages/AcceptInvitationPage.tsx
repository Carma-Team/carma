import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { attemptRefresh } from '@/lib/auth/refresh';
import { getSession } from '@/lib/auth/session';
import { acceptInvitation, previewInvitation, type InvitationPreview } from '@/lib/api/businessInvitations';
import { Card, Heading, Text, Button, ErrorState, LoadingState } from '@/components/ui';
import styles from './AcceptInvitationPage.module.css';

type PreviewStatus = 'loading' | 'ok' | 'invalid' | 'error';
// 'ambiguous' and 'reconcile_*' are reachable once the server has confirmed
// (or plausibly confirmed — see 'indeterminate' below) acceptance — a
// membership may already exist from this point on, no matter which of these
// this session's reconciliation lands on. 'indeterminate' is different: it
// means the *accept* call itself never got an answer (a lost response or a
// transient failure), not that reconciliation of a known acceptance failed —
// the membership may or may not exist yet, which is exactly why this state
// never claims failure and never blindly repeats the mutation without first
// checking.
type AcceptPhase =
  | 'idle'
  | 'accepting'
  | 'indeterminate'
  | 'already_member'
  | 'ambiguous'
  | 'reconcile_rejected'
  | 'reconcile_transient';

function roleKey(role: InvitationPreview['role']): 'Manager' | 'Cashier' {
  return role === 'manager' ? 'Manager' : 'Cashier';
}

// The recipient side of CAR-118 — reachable at the exact link shape
// `services/business_invitations.py::_link` generates
// (`{invite_base_url}/business-invite#{token}`), and also from a manually
// typed code via `AcceptInvitationEntryPage`. Sits outside `ProtectedRoute`
// on purpose: an unauthenticated recipient must be able to land here at all,
// see the invitation is theirs, and only then be sent to sign in or register
// — never the reverse order, which would mean redirecting before the
// recipient has any idea what they were invited to.
//
// The token lives in the URL *fragment*, not a `:token` path param — a
// fragment is never sent in the HTTP request, to this server or to any
// CDN/proxy in front of it, so it cannot land in a web-host access log the
// way a path segment inevitably would (see `_link`'s own docstring).
export function AcceptInvitationPage() {
  const location = useLocation();
  const token = decodeURIComponent(location.hash.slice(1));
  const { t } = useTranslation();
  const { status, logout, user } = useAuth();
  const navigate = useNavigate();

  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>('loading');
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [acceptPhase, setAcceptPhase] = useState<AcceptPhase>('idle');
  const [reconciling, setReconciling] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const acceptInFlight = useRef(false);
  // The business an accept attempt claims (or may claim) membership in —
  // either the server's own confirmed answer ('ok'/'already_member'), or,
  // for an indeterminate outcome, the invitation's own preview businessId,
  // which is what "this actually already succeeded" would resolve to. Never
  // re-read to decide whether to call `acceptInvitation` again — its only
  // job is giving the reconciliation check below something to compare the
  // refreshed session against.
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
      // The membership itself might predate this click, but "already a
      // member" is still a real, server-confirmed fact — reconcile before
      // deciding what to show, the same as a fresh 'ok' does, rather than
      // navigating (or not) off whatever `useAuth()` happened to hold before
      // this request (CAR-118 review item 3).
      acceptedBusinessId.current = preview?.businessId ?? null;
      const settled = await reconcileAfterAccept();
      if (!settled) {
        // Reconciliation came back clean but doesn't show the membership the
        // server just confirmed exists (an unusually stale race) — this is
        // still a true, safe thing to say, never a claim of failure.
        setAcceptPhase('already_member');
      }
      return;
    }

    // 'invalid' | 'network_error' | 'unexpected_error': none of these prove
    // the mutation didn't land — a lost response, or a race the server
    // itself resolved a moment before this call, can look identical to a
    // clean failure from here (CAR-118 review item 1). Reconcile against
    // authoritative session state, using the business this invitation named
    // (fetched at preview time, before this attempt) as what "this actually
    // already succeeded" would look like, before ever calling it a failure.
    acceptedBusinessId.current = preview?.businessId ?? null;
    const settled = acceptedBusinessId.current ? await reconcileAfterAccept() : false;
    if (settled) return;

    // Reconciliation confirmed no membership exists in the invited business
    // — this account genuinely has not redeemed this token.
    if (result.outcome === 'invalid') {
      setPreviewStatus('invalid');
      setAcceptPhase('idle');
    } else {
      // Never "failed" — safe to retry, because a not-yet-redeemed
      // invitation just gets redeemed normally, and a token this same
      // account already redeemed answers 'already_member' next time, not a
      // second, silently-accepted mutation.
      setAcceptPhase('indeterminate');
    }
  }

  // Server-authoritative reconciliation (CAR-118): whatever `acceptedBusinessId`
  // names was already decided in the database by the time this runs (either
  // because the server just said so, or because it might have on a call
  // whose response never reached us) — so the session is refreshed from
  // there rather than assembled or trusted client-side. Split out from
  // `handleAccept` so the "Retry" action on a transient reconciliation
  // failure below can re-run only this half — `acceptInvitation` must never
  // be called a second time for a token the server may have already
  // consumed. Returns whether this call reached a terminal, displayed
  // outcome (navigated, or shown ambiguous/rejected/transient) — `false`
  // means reconciliation completed cleanly and the account genuinely holds
  // no membership in `acceptedBusinessId` yet, leaving the caller to decide
  // what that means for the specific call that led here.
  async function reconcileAfterAccept(): Promise<boolean> {
    setReconciling(true);
    const outcome = await attemptRefresh();
    setReconciling(false);

    if (outcome !== 'ok') {
      // Neither of these means the acceptance failed — the membership may
      // already be committed server-side. 'rejected' is a genuinely dead
      // session (the refresh cookie is gone); 'transient' is a network/5xx
      // blip that says nothing about session validity either way (see
      // `lib/auth/refresh.ts`) — both get a distinct message from an actual
      // accept failure, and neither offers to redeem the token again.
      setAcceptPhase(outcome === 'rejected' ? 'reconcile_rejected' : 'reconcile_transient');
      return true;
    }

    const refreshedUser = getSession()?.user;
    if (
      refreshedUser &&
      !refreshedUser.businessMembershipAmbiguous &&
      refreshedUser.businessMembershipRole &&
      refreshedUser.businessId === acceptedBusinessId.current
    ) {
      navigate('/', { replace: true });
      return true;
    }
    // Fails closed the same way CAR-258's own server contract does: an
    // ambiguous account, or one resolved to some business other than the one
    // this invitation named, both mean the account cannot be placed into a
    // single unambiguous business context. Business-context selection is
    // explicitly out of scope here (CAR-258) and nowhere else in this app
    // either, so this is a terminal state, not a retryable one.
    if (
      refreshedUser &&
      (refreshedUser.businessMembershipAmbiguous ||
        (refreshedUser.businessMembershipRole && refreshedUser.businessId !== acceptedBusinessId.current))
    ) {
      setAcceptPhase('ambiguous');
      return true;
    }
    return false;
  }

  async function handleSignOutAfterAmbiguousAcceptance() {
    await logout();
    navigate('/sign-in', { replace: true });
  }

  // Pre-mutation guard (CAR-118 review item 2): an account already resolved
  // to a business other than the one this invitation names — or ambiguous
  // across more than one — must never be allowed to consume the invitation
  // at all. Accepting would create a second, real membership this portal has
  // no way to enter (business switching is out of scope), and the mutation
  // cannot be undone from here once it lands. Same-business membership is
  // not incompatible — it safely no-ops through the ordinary `already_member`
  // path instead. A session that changed *after* this render is not this
  // check's job to catch; `reconcileAfterAccept` above is what makes the
  // outcome safe even if this guard was stale the moment it ran.
  const incompatibleBusiness =
    preview !== null &&
    user !== null &&
    (user.businessMembershipAmbiguous || (user.businessMembershipRole !== null && user.businessId !== preview.businessId));

  async function handleSignOutIncompatibleBusiness() {
    const from = location.pathname + location.hash;
    await logout();
    navigate('/sign-in', { state: { from }, replace: true });
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

  // Reachable only after `handleAccept` reconciled and found no membership
  // in the invited business — never shown for a response that definitely
  // never landed anywhere (a network error before the request left the
  // browser reaches the same reconciliation, and settles here identically).
  if (acceptPhase === 'indeterminate') {
    return (
      <main className={styles.page}>
        <Card className={styles.card}>
          <Heading level={1}>{t('invitations.indeterminateTitle')}</Heading>
          <Text variant="body">{t('invitations.indeterminateMessage')}</Text>
          <Button onClick={handleAccept}>{t('invitations.indeterminateRetryButton')}</Button>
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
    // `pathname + hash`, not `pathname` alone — the token lives in the
    // fragment now, and router *state* (never a query param or storage) is
    // what actually carries it through the detour, so the recipient lands
    // back here — and only here, with the token intact — once signed in or
    // registered.
    const from = location.pathname + location.hash;
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

  if (incompatibleBusiness) {
    return (
      <main className={styles.page}>
        <Card className={styles.card}>
          <Heading level={1}>{t('invitations.incompatibleBusinessTitle')}</Heading>
          <Text variant="body">{t('invitations.incompatibleBusinessMessage')}</Text>
          <Button onClick={handleSignOutIncompatibleBusiness}>{t('invitations.incompatibleBusinessSignOutButton')}</Button>
        </Card>
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

        <Button onClick={handleAccept} disabled={acceptPhase === 'accepting'}>
          {acceptPhase === 'accepting' ? t('invitations.acceptingLabel') : t('invitations.acceptButton')}
        </Button>
      </Card>
    </main>
  );
}
