import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { attemptRefresh } from '@/lib/auth/refresh';
import { getSession } from '@/lib/auth/session';
import { acceptInvitation, previewInvitation, type InvitationPreview } from '@/lib/api/businessInvitations';
import { Card, Heading, Text, Button, ErrorState, LoadingState } from '@/components/ui';
import styles from './AcceptInvitationPage.module.css';

// Mirrors the server's `READABLE_ALPHABET` + fixed length
// (`services/business_invitations.py`) — a UI-only pre-filter so a garbled
// or foreign fragment never even reaches the network, not a security
// boundary (the server is still the only authority on a real token).
const TOKEN_PATTERN = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/;

type PreviewStatus = 'loading' | 'ok' | 'invalid' | 'error';

// Every one of these is reachable only once an accept attempt has actually
// happened (or, for 'incompatible_business', can be reached either before
// one — the pre-mutation guard — or after one, whether the server itself
// refused the exact same way, or reconciliation resolved to a single,
// definite, different business — see 'incompatible_business' below):
//   - 'checking'   — reconciling to find out what an accept response
//                    actually means; never claims an outcome either way.
//   - 'ambiguous'  — the account holds a real, confirmed membership, but the
//                    server itself cannot resolve it to any one business
//                    (CAR-258) — never used for an account that resolves
//                    cleanly to a single, different business; that is
//                    'incompatible_business' below, since claiming "you
//                    already have access to this business" would be false.
//   - 'auth_required' — reconciliation needs a live session to answer at
//                    all; neutral copy, since this is reachable whether or
//                    not the accept itself was ever confirmed.
//   - 'transient'  — reconciliation itself failed transiently; retry
//                    reconciliation only, never the accept mutation.
//   - 'incompatible_business' — the account belongs to a single, definite,
//                    different business — either confirmed before any
//                    accept attempt (the pre-mutation guard), or resolved
//                    that way by reconciliation afterward. Never phrased as
//                    "accepted" or "already have access [to this one]".
// Falling out of 'checking' with none of the above met returns to 'idle' —
// the account provably does not hold the invited membership yet, so
// attempting acceptance again is safe.
type AcceptPhase = 'idle' | 'accepting' | 'checking' | 'ambiguous' | 'auth_required' | 'transient' | 'incompatible_business';

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
// way a path segment inevitably would (see `_link`'s own docstring). There
// is no other route shape for this page: CAR-118 has never been deployed,
// so there is no legacy link anywhere to stay compatible with (CAR-118
// review item 5) — the only invitation URLs that exist are the ones this
// page itself has ever generated.
export function AcceptInvitationPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { status, logout, user } = useAuth();

  // A malformed fragment (`#%`, invalid percent-encoding) must never crash
  // rendering — `decodeURIComponent` throws `URIError` on one, so this is
  // deliberately not a bare `decodeURIComponent(...)` at the top of the
  // component.
  let decodedToken: string | null;
  try {
    decodedToken = location.hash.length > 1 ? decodeURIComponent(location.hash.slice(1)) : null;
  } catch {
    decodedToken = null;
  }
  const token = decodedToken ?? '';
  const tokenLooksValid = decodedToken !== null && TOKEN_PATTERN.test(decodedToken);

  // The token this preview answers for is part of the state itself, not a
  // separate variable — CAR-118 review item 1: if the fragment changes to a
  // different invitation while a request is still in flight (or right after
  // one resolves), a `status`/`data` pair alone cannot prove which token it
  // describes. Comparing `.token` against the live `token` below is what
  // makes a stale answer for a token that is no longer current impossible to
  // read as though it were — no effect-body reset needed: the moment `token`
  // changes, every derived value below stops matching on its own, before the
  // new request has even started, let alone resolved.
  const [previewState, setPreviewState] = useState<{
    token: string;
    status: PreviewStatus;
    data: InvitationPreview | null;
  }>({ token: '', status: 'loading', data: null });
  const previewIsCurrent = previewState.token === token;
  // A malformed/empty/unsupported-shape fragment is 'invalid' immediately,
  // and a token this preview doesn't (yet) answer for is 'loading' — both
  // derived here, never written from the effect, so there is no state to
  // synchronize and no render-time setState warning.
  const effectivePreviewStatus: PreviewStatus = !tokenLooksValid ? 'invalid' : previewIsCurrent ? previewState.status : 'loading';
  const preview = previewIsCurrent ? previewState.data : null;
  const previewReady = effectivePreviewStatus === 'ok' && preview !== null;
  const [acceptPhase, setAcceptPhase] = useState<AcceptPhase>('idle');
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
  // What the *next* (or most recent) reconciliation should do with its
  // answer — captured once per accept attempt so the transient-retry button
  // can re-run reconciliation alone and still interpret it the same way.
  const settleContext = useRef<{
    // Did the accept response itself already confirm success ('ok' or
    // 'already_member')? Governs whether an ambiguous reconciliation result
    // may be attributed to *this* attempt at all (CAR-118 review item 2) —
    // an unconfirmed attempt cannot safely claim an ambiguous account is a
    // consequence of this click, since the account may already have been
    // ambiguous for an unrelated reason.
    confirmed: boolean;
    // Which copy an 'ambiguous' outcome should use — accepting this
    // invitation is not the same claim as already having had access to it.
    origin: 'accepted' | 'already_member';
    // What "conclusively not a member yet" resolves to: back to the normal
    // accept form ('idle'), or — only for a definitive server 'invalid' —
    // the invalid-invitation state.
    notAcceptedFallback: 'idle' | 'invalid';
  }>({ confirmed: false, origin: 'accepted', notAcceptedFallback: 'idle' });

  useEffect(() => {
    // Malformed, empty, or unsupported-shape — never worth a round trip; the
    // server would answer identically to any other invalid token, but there
    // is no reason to ask it. Nothing is written here for this case: the
    // 'invalid' fragment shape is already handled by `effectivePreviewStatus`
    // above, purely from `tokenLooksValid`.
    if (status !== 'authenticated' || !tokenLooksValid) return;
    let cancelled = false;
    const requestedToken = token;
    previewInvitation(requestedToken).then((result) => {
      if (cancelled) return;
      if (result.outcome === 'ok') {
        setPreviewState({ token: requestedToken, status: 'ok', data: result.invitation });
      } else if (result.outcome === 'invalid') {
        setPreviewState({ token: requestedToken, status: 'invalid', data: null });
      } else {
        setPreviewState({ token: requestedToken, status: 'error', data: null });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [status, token, tokenLooksValid, retryCount]);

  function retryPreview() {
    setRetryCount((count) => count + 1);
  }

  async function handleAccept() {
    if (acceptInFlight.current || !previewReady) return;
    // Bound to `previewState.token`, not the live `token` — the two are
    // equal whenever `previewReady` holds, but naming the token this way
    // makes the binding explicit rather than incidental (CAR-118 review item
    // 1): this call can only ever operate on the exact token whose preview
    // is currently on screen.
    const acceptingToken = previewState.token;
    acceptInFlight.current = true;
    setAcceptPhase('accepting');

    const result = await acceptInvitation(acceptingToken);
    acceptInFlight.current = false;

    if (result.outcome === 'ok') {
      acceptedBusinessId.current = result.membership.businessId;
      await settle({ confirmed: true, origin: 'accepted', notAcceptedFallback: 'idle' });
      return;
    }
    if (result.outcome === 'already_member') {
      // The membership itself might predate this click, but "already a
      // member" is still a real, server-confirmed fact — reconcile before
      // deciding what to show, the same as a fresh 'ok' does, rather than
      // navigating (or not) off whatever `useAuth()` happened to hold before
      // this request (CAR-118 review item 4).
      acceptedBusinessId.current = preview?.businessId ?? null;
      await settle({ confirmed: true, origin: 'already_member', notAcceptedFallback: 'idle' });
      return;
    }
    if (result.outcome === 'incompatible_business') {
      // Authoritative and server-confirmed: nothing was consumed (CAR-118
      // review item 3), so there is nothing left to reconcile — this is the
      // exact same terminal state the pre-mutation guard below shows,
      // reached this time because a race let the click through before that
      // guard's own picture was fresh.
      setAcceptPhase('incompatible_business');
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
    await settle({
      confirmed: false,
      origin: 'accepted',
      notAcceptedFallback: result.outcome === 'invalid' ? 'invalid' : 'idle',
    });
  }

  async function settle(context: typeof settleContext.current) {
    settleContext.current = context;
    await runSettle();
  }

  // Server-authoritative reconciliation (CAR-118): whatever `acceptedBusinessId`
  // names was already decided in the database by the time this runs (either
  // because the server just said so, or because it might have on a call
  // whose response never reached us) — so the session is refreshed from
  // there rather than assembled or trusted client-side. `settleContext`
  // (not a fresh argument) is what lets the transient-retry button below
  // re-run only this half — `acceptInvitation` must never be called a
  // second time for a token the server may have already consumed.
  async function runSettle() {
    setAcceptPhase('checking');
    const outcome = await attemptRefresh();
    const { confirmed, notAcceptedFallback } = settleContext.current;

    if (outcome === 'rejected') {
      // Neither this nor 'transient' below means the acceptance failed —
      // the membership may already be committed server-side either way.
      // Neutral copy regardless of `confirmed`: this step genuinely cannot
      // say whether it succeeded, so it must not claim either answer.
      setAcceptPhase('auth_required');
      return;
    }
    if (outcome === 'transient') {
      setAcceptPhase('transient');
      return;
    }

    const refreshedUser = getSession()?.user;
    if (
      refreshedUser &&
      !refreshedUser.businessMembershipAmbiguous &&
      refreshedUser.businessMembershipRole &&
      refreshedUser.businessId === acceptedBusinessId.current
    ) {
      navigate('/', { replace: true });
      return;
    }

    // Two genuinely different outcomes, never conflated (CAR-118 review item
    // 4): a server-flagged ambiguous account (multiple memberships, CAR-258
    // cannot resolve which is "current") is not the same claim as an account
    // that resolves cleanly to one real membership in a business other than
    // the one this invitation named — e.g. the invited membership was
    // revoked, or reassigned, between the accept response and this refresh.
    // The first can honestly say "you already have access [somewhere]"; the
    // second cannot say that about *this* business, so it reuses
    // 'incompatible_business' — the same truthful "this account belongs to a
    // different business" state the pre-mutation guard below shows — rather
    // than the ambiguous copy, which would otherwise claim access this
    // account provably does not have.
    const trueAmbiguous = refreshedUser?.businessMembershipAmbiguous === true;
    const resolvedToADifferentBusiness =
      !trueAmbiguous && !!refreshedUser?.businessMembershipRole && refreshedUser.businessId !== acceptedBusinessId.current;

    if (confirmed && (trueAmbiguous || resolvedToADifferentBusiness)) {
      // Fails closed the same way CAR-258's own server contract does — but
      // only when this specific attempt was already server-confirmed. An
      // *unconfirmed* attempt reconciling this way cannot safely be
      // attributed to this click (the account may already have been in this
      // shape, unrelated to whether this token was ever redeemed), so that
      // case falls through to "not a member yet" below instead.
      setAcceptPhase(resolvedToADifferentBusiness ? 'incompatible_business' : 'ambiguous');
      return;
    }

    // Conclusively not a member of the invited business (or an unconfirmed
    // attempt whose ambiguity cannot be attributed to it) — safe to attempt
    // acceptance again, unless the server already gave a definitive verdict
    // on this exact token ('invalid').
    if (notAcceptedFallback === 'invalid') {
      setPreviewState({ token, status: 'invalid', data: null });
    }
    setAcceptPhase('idle');
  }

  function handleSignInFromAuthRequired() {
    const from = location.pathname + location.hash;
    navigate('/sign-in', { state: { from }, replace: true });
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
  // path instead. Recomputed every render (not stored state) so it never
  // gets stuck stale; the *authoritative* guard is the server's own refusal
  // (`accept_invitation`'s cross-business check under a per-user lock) —
  // this is the pre-emptive UX layer in front of it, not the only one.
  //
  // Gated to `acceptPhase === 'idle'`: once an accept attempt has actually
  // run, `user` reflects *that attempt's own* reconciliation (e.g. an
  // 'incompatible_business' phase deliberately leaves the session showing
  // that resolved profile) — re-evaluating this pre-check against that
  // post-attempt state would override the correct, already-decided phase
  // with this earlier, no-longer-relevant guard.
  const incompatibleBusiness =
    acceptPhase === 'idle' &&
    previewReady &&
    user !== null &&
    (user.businessMembershipAmbiguous || (user.businessMembershipRole !== null && user.businessId !== preview?.businessId));

  async function handleSignOutIncompatibleBusiness() {
    const from = location.pathname + location.hash;
    await logout();
    navigate('/sign-in', { state: { from }, replace: true });
  }

  if (acceptPhase === 'incompatible_business' || incompatibleBusiness) {
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

  // All four below are reachable only once an accept attempt has run —
  // checked ahead of `status` on purpose. A rejected reconciliation clears
  // the session as a side effect (`applyRefreshRejection` in
  // `lib/auth/session.ts`), which flips `status` to 'unauthenticated' the
  // moment it happens; without this ordering that flip would replace this
  // outcome with the generic sign-in-or-register choice screen below,
  // losing the fact that an accept attempt is still being resolved.
  if (acceptPhase === 'ambiguous') {
    const ambiguousAlreadyMember = settleContext.current.origin === 'already_member';
    return (
      <main className={styles.page}>
        <Card className={styles.card}>
          <Heading level={1}>
            {t(ambiguousAlreadyMember ? 'invitations.alreadyMemberAmbiguousTitle' : 'invitations.ambiguousTitle')}
          </Heading>
          <Text variant="body">
            {t(ambiguousAlreadyMember ? 'invitations.alreadyMemberAmbiguousMessage' : 'invitations.ambiguousMessage')}
          </Text>
          <Button onClick={handleSignOutAfterAmbiguousAcceptance}>{t('invitations.ambiguousSignOutButton')}</Button>
        </Card>
      </main>
    );
  }

  if (acceptPhase === 'auth_required') {
    return (
      <main className={styles.page}>
        <Card className={styles.card}>
          <Heading level={1}>{t('invitations.authRequiredTitle')}</Heading>
          <Text variant="body">{t('invitations.authRequiredMessage')}</Text>
          <Button onClick={handleSignInFromAuthRequired}>{t('invitations.signInLinkLabel')}</Button>
        </Card>
      </main>
    );
  }

  if (acceptPhase === 'transient') {
    return (
      <main className={styles.page}>
        <Card className={styles.card}>
          <Heading level={1}>{t('invitations.transientTitle')}</Heading>
          <Text variant="body">{t('invitations.transientMessage')}</Text>
          <Button onClick={runSettle}>{t('invitations.transientRetryButton')}</Button>
        </Card>
      </main>
    );
  }

  if (acceptPhase === 'checking') {
    return (
      <main className={styles.page}>
        <LoadingState label={t('invitations.checkingStatusLabel')} />
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
    // fragment now, and router (history) state is what actually carries it
    // through the detour: it never reaches the URL, so it never reaches
    // server logs, analytics, or a browser's address-bar autocomplete the
    // way a query param would — but it *is* still browser-held state, part
    // of this session-history entry, not something that exists only in
    // memory (CAR-118 review item 5). That's exactly why `AcceptInvitationPage`
    // never treats it as the *only* way back to this invitation: the
    // fragment itself, read straight from `location.hash` above, is what
    // actually survives a hard reload or a fresh tab — history state riding
    // along on top of it is a convenience for the common case, not the
    // recovery path's foundation.
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

  if (effectivePreviewStatus === 'invalid') {
    return (
      <main className={styles.page}>
        <ErrorState title={t('invitations.invalidTitle')} message={t('invitations.invalidMessage')} />
      </main>
    );
  }

  if (effectivePreviewStatus === 'error') {
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

  // 'loading', or 'ok' with `preview` somehow still null — the latter should
  // be unreachable (the 'ok' branch above always sets `data` alongside it),
  // but failing safe into the same loading state rather than the accept form
  // is the correct default either way.
  if (effectivePreviewStatus === 'loading' || !previewReady || !preview) {
    return (
      <main className={styles.page}>
        <LoadingState label={t('invitations.loadingPreviewLabel')} />
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
