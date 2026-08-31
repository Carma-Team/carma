import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { AcceptInvitationPage } from './AcceptInvitationPage';
import { acceptInvitation, previewInvitation } from '@/lib/api/businessInvitations';
import type { InvitationPreview, AcceptedMembership } from '@/lib/api/businessInvitations';
import { useAuth } from '@/hooks/useAuth';
import { attemptRefresh } from '@/lib/auth/refresh';
// Deliberately the *real* module: the page reads the just-refreshed session
// straight off the store (not off `useAuth()`, which the tests below mock
// with a fixed value) to decide whether the acceptance landed in a single,
// unambiguous business — seeding/reading the real store here is the only
// faithful way to prove that check without a second layer of mocks.
import { setSession } from '@/lib/auth/session';
import type { AuthUser } from '@/lib/auth/types';

vi.mock('@/lib/api/businessInvitations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/businessInvitations')>();
  return { ...actual, previewInvitation: vi.fn(), acceptInvitation: vi.fn() };
});
vi.mock('@/lib/auth/refresh', () => ({ attemptRefresh: vi.fn() }));
vi.mock('@/hooks/useAuth');

const PREVIEW: InvitationPreview = {
  businessId: 'b1',
  businessName: 'Aroma Israel',
  role: 'manager',
  expiresAt: '2026-09-01T00:00:00Z',
};

const MEMBERSHIP: AcceptedMembership = { businessId: 'b1', role: 'manager' };

const BASE_USER: AuthUser = {
  id: 'u1',
  name: 'Recipient',
  email: 'recipient@example.com',
  role: 'DRIVER',
  businessId: null,
  businessCategory: null,
  businessName: null,
  businessNameHe: null,
  businessMembershipRole: null,
  businessMembershipAmbiguous: false,
};

// What a real `attemptRefresh()` does as a side effect (via
// `applyRefreshSuccess`) once CAR-258 resolves the post-acceptance profile —
// simulated here since `lib/auth/refresh` is mocked wholesale above.
function resolvedSingleBusiness(): Promise<'ok'> {
  setSession({
    accessToken: 'tok',
    user: { ...BASE_USER, businessId: 'b1', businessMembershipRole: 'MANAGER', businessMembershipAmbiguous: false },
  });
  return Promise.resolve('ok');
}

function resolvedAmbiguous(): Promise<'ok'> {
  setSession({
    accessToken: 'tok',
    user: { ...BASE_USER, businessId: null, businessMembershipRole: null, businessMembershipAmbiguous: true },
  });
  return Promise.resolve('ok');
}

// A clean, successful refresh that shows the account genuinely holds no
// membership in the invited business — what reconciliation looks like when
// an accept attempt (of any kind) truly never took effect.
function resolvedNoBusiness(): Promise<'ok'> {
  setSession({ accessToken: 'tok', user: BASE_USER });
  return Promise.resolve('ok');
}

// Not ambiguous — a single, real, resolvable membership, just not in the
// invited business (e.g. the invited membership was revoked and the account
// reassigned elsewhere between the server's answer and this refresh).
// CAR-118 review item 4: this must never read as "you already have access to
// this business" the way a true ambiguous account's copy honestly can.
function resolvedDifferentBusiness(): Promise<'ok'> {
  setSession({
    accessToken: 'tok',
    user: {
      ...BASE_USER,
      businessId: 'other-business',
      businessMembershipRole: 'CASHIER',
      businessMembershipAmbiguous: false,
    },
  });
  return Promise.resolve('ok');
}

// Echoes router state's `from`, proving the token actually round-trips
// through a sign-in/sign-out detour rather than just landing on some page.
function FromProbe() {
  const location = useLocation();
  return <div>from: {(location.state as { from?: string } | null)?.from}</div>;
}

function renderAt(path: string, extraRoutes: { path: string; element: React.ReactNode }[] = []) {
  const router = createMemoryRouter(
    [
      // Ahead of the fixed stubs below so a caller-supplied route for the
      // same path (e.g. a `/sign-in` that echoes router state) wins the match.
      ...extraRoutes,
      { path: '/business-invite', element: <AcceptInvitationPage /> },
      { path: '/', element: <div>home</div> },
      { path: '/sign-in', element: <div>sign-in page</div> },
      { path: '/create-account', element: <div>create-account page</div> },
    ],
    { initialEntries: [path] },
  );
  return render(
    <LanguageProvider>
      <RouterProvider router={router} />
    </LanguageProvider>,
  );
}

function mockAuth(overrides: Partial<ReturnType<typeof useAuth>>) {
  vi.mocked(useAuth).mockReturnValue({
    status: 'authenticated',
    user: null,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    retry: vi.fn(),
    ...overrides,
  });
}

describe('AcceptInvitationPage', () => {
  beforeEach(() => {
    vi.mocked(previewInvitation).mockReset();
    vi.mocked(acceptInvitation).mockReset();
    vi.mocked(attemptRefresh).mockReset();
    setSession(null);
  });

  afterEach(() => {
    setSession(null);
    vi.restoreAllMocks();
  });

  it('offers a sign-in-or-register choice for an unauthenticated recipient, without previewing anything', async () => {
    mockAuth({ status: 'unauthenticated' });

    renderAt('/business-invite#TXQ947ZKPS');

    await waitFor(() => expect(screen.getByText('כבר יש לכם חשבון?')).toBeInTheDocument());
    expect(screen.getByText('עדיין אין לכם חשבון?')).toBeInTheDocument();
    expect(previewInvitation).not.toHaveBeenCalled();
  });

  it('carries the invitation link forward through the sign-in detour, landing back on the same invitation', async () => {
    mockAuth({ status: 'unauthenticated' });

    renderAt('/business-invite#TXQ947ZKPS');
    await waitFor(() => expect(screen.getByRole('button', { name: 'התחברות' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'התחברות' }));

    await waitFor(() => expect(screen.getByText('sign-in page')).toBeInTheDocument());
  });

  it('carries the invitation link forward through the create-account detour', async () => {
    mockAuth({ status: 'unauthenticated' });

    renderAt('/business-invite#TXQ947ZKPS');
    await waitFor(() => expect(screen.getByRole('button', { name: 'יצירת חשבון' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'יצירת חשבון' }));

    await waitFor(() => expect(screen.getByText('create-account page')).toBeInTheDocument());
  });

  it('shows the business and role before any acceptance, for an authenticated recipient', async () => {
    mockAuth({ status: 'authenticated' });
    vi.mocked(previewInvitation).mockResolvedValue({ outcome: 'ok', invitation: PREVIEW });

    renderAt('/business-invite#TXQ947ZKPS');

    await waitFor(() => expect(screen.getByText('Aroma Israel')).toBeInTheDocument());
    expect(screen.getByText('מנהל')).toBeInTheDocument();
    expect(previewInvitation).toHaveBeenCalledExactlyOnceWith('TXQ947ZKPS');
    expect(acceptInvitation).not.toHaveBeenCalled();
  });

  it.each([
    ['an unknown token', 'invalid'],
    ['a used, revoked, or expired token', 'invalid'],
  ] as const)('renders the same invalid-invitation message for %s', async (_label, outcome) => {
    mockAuth({ status: 'authenticated' });
    vi.mocked(previewInvitation).mockResolvedValue({ outcome });

    renderAt('/business-invite#TXQ947ZKPS');

    await waitFor(() => expect(screen.getByText('ההזמנה אינה תקפה')).toBeInTheDocument());
  });

  it('accepts the invitation, reconciles the session, and lands on the business interface for a normal single-membership recipient', async () => {
    mockAuth({ status: 'authenticated' });
    vi.mocked(previewInvitation).mockResolvedValue({ outcome: 'ok', invitation: PREVIEW });
    vi.mocked(acceptInvitation).mockResolvedValue({ outcome: 'ok', membership: MEMBERSHIP });
    vi.mocked(attemptRefresh).mockImplementation(resolvedSingleBusiness);

    renderAt('/business-invite#TXQ947ZKPS');
    await waitFor(() => expect(screen.getByRole('button', { name: 'אישור ההזמנה' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'אישור ההזמנה' }));

    await waitFor(() => expect(acceptInvitation).toHaveBeenCalledExactlyOnceWith('TXQ947ZKPS'));
    // Server-authoritative reconciliation — the client never assembles its
    // own session from the accept response, it re-fetches from the server.
    await waitFor(() => expect(attemptRefresh).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByText('home')).toBeInTheDocument());
  });

  it('never sends a second accept request while one is in flight', async () => {
    mockAuth({ status: 'authenticated' });
    vi.mocked(previewInvitation).mockResolvedValue({ outcome: 'ok', invitation: PREVIEW });
    let resolveAccept: (value: Awaited<ReturnType<typeof acceptInvitation>>) => void = () => {};
    vi.mocked(acceptInvitation).mockReturnValue(
      new Promise((resolve) => {
        resolveAccept = resolve;
      }),
    );
    vi.mocked(attemptRefresh).mockImplementation(resolvedSingleBusiness);

    renderAt('/business-invite#TXQ947ZKPS');
    await waitFor(() => expect(screen.getByRole('button', { name: 'אישור ההזמנה' })).toBeInTheDocument());

    const acceptButton = screen.getByRole('button', { name: /אישור ההזמנה|מאשר/ });
    fireEvent.click(acceptButton);
    fireEvent.click(acceptButton);
    fireEvent.click(acceptButton);

    resolveAccept({ outcome: 'ok', membership: MEMBERSHIP });
    await waitFor(() => expect(screen.getByText('home')).toBeInTheDocument());
    expect(acceptInvitation).toHaveBeenCalledOnce();
  });

  // CAR-258's fail-closed multi-membership contract, reaching CAR-118's
  // accept flow: the membership this invitation granted is real and already
  // committed, but the recipient's account also belongs to another business,
  // so the refreshed profile comes back with no resolvable role at all.
  it('shows a dedicated accepted-but-ambiguous state instead of the generic access-restricted route, and does not offer to accept again', async () => {
    mockAuth({ status: 'authenticated' });
    vi.mocked(previewInvitation).mockResolvedValue({ outcome: 'ok', invitation: PREVIEW });
    vi.mocked(acceptInvitation).mockResolvedValue({ outcome: 'ok', membership: MEMBERSHIP });
    vi.mocked(attemptRefresh).mockImplementation(resolvedAmbiguous);

    renderAt('/business-invite#TXQ947ZKPS');
    await waitFor(() => expect(screen.getByRole('button', { name: 'אישור ההזמנה' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'אישור ההזמנה' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'ההזמנה אושרה' })).toBeInTheDocument());
    // The sign-out action is specific to the ambiguous state — its presence
    // distinguishes this from the transient-reconciliation state below,
    // which shares the same heading but offers "try again" instead.
    expect(screen.getByRole('button', { name: 'התנתקות' })).toBeInTheDocument();
    // Never the generic "access restricted" copy a null role would otherwise
    // produce via RequireBusinessRole — this page never navigates there.
    expect(screen.queryByText('הגישה מוגבלת')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'אישור ההזמנה' })).not.toBeInTheDocument();
    expect(acceptInvitation).toHaveBeenCalledOnce();
  });

  it('offers sign-out, not another acceptance attempt, from the accepted-but-ambiguous state', async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    mockAuth({ status: 'authenticated', logout });
    vi.mocked(previewInvitation).mockResolvedValue({ outcome: 'ok', invitation: PREVIEW });
    vi.mocked(acceptInvitation).mockResolvedValue({ outcome: 'ok', membership: MEMBERSHIP });
    vi.mocked(attemptRefresh).mockImplementation(resolvedAmbiguous);

    renderAt('/business-invite#TXQ947ZKPS');
    await waitFor(() => expect(screen.getByRole('button', { name: 'אישור ההזמנה' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'אישור ההזמנה' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'ההזמנה אושרה' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'התנתקות' }));

    await waitFor(() => expect(logout).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByText('sign-in page')).toBeInTheDocument());
  });

  // A 'rejected' outcome means the session is genuinely gone — but that says
  // nothing about whether the membership was created, so this must never
  // read as "acceptance failed" (or, since this reconciliation can be
  // reached from an unconfirmed attempt too, as "acceptance succeeded"
  // either). Copy must stay neutral, and the recovery path back to this
  // exact invitation must survive the sign-in detour (CAR-118 review item 2).
  it('makes no claim either way when session reconciliation is rejected, and preserves the invitation recovery path through sign-in', async () => {
    mockAuth({ status: 'authenticated' });
    vi.mocked(previewInvitation).mockResolvedValue({ outcome: 'ok', invitation: PREVIEW });
    vi.mocked(acceptInvitation).mockResolvedValue({ outcome: 'ok', membership: MEMBERSHIP });
    vi.mocked(attemptRefresh).mockResolvedValue('rejected');

    renderAt('/business-invite#TXQ947ZKPS', [{ path: '/sign-in', element: <FromProbe /> }]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'אישור ההזמנה' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'אישור ההזמנה' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'יש להתחבר מחדש' })).toBeInTheDocument());
    expect(screen.queryByText('ההזמנה אושרה')).not.toBeInTheDocument();
    expect(screen.queryByText('לא הצלחנו לאשר את ההזמנה. נסו שוב.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'התחברות' }));
    await waitFor(() => expect(screen.getByText('from: /business-invite#TXQ947ZKPS')).toBeInTheDocument());
    expect(acceptInvitation).toHaveBeenCalledOnce();
  });

  // A 'transient' outcome (network/5xx) says nothing about whether the
  // membership or the session are actually fine — retrying must re-check the
  // session only, never re-spend the already-consumed token.
  it('makes no claim either way on a transient reconciliation failure, and retrying reconciles without accepting again', async () => {
    mockAuth({ status: 'authenticated' });
    vi.mocked(previewInvitation).mockResolvedValue({ outcome: 'ok', invitation: PREVIEW });
    vi.mocked(acceptInvitation).mockResolvedValue({ outcome: 'ok', membership: MEMBERSHIP });
    vi.mocked(attemptRefresh).mockResolvedValueOnce('transient').mockImplementationOnce(resolvedSingleBusiness);

    renderAt('/business-invite#TXQ947ZKPS');
    await waitFor(() => expect(screen.getByRole('button', { name: 'אישור ההזמנה' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'אישור ההזמנה' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'לא הצלחנו לוודא את סטטוס ההזמנה' })).toBeInTheDocument());
    expect(screen.queryByText('ההזמנה אושרה')).not.toBeInTheDocument();
    expect(screen.queryByText('לא הצלחנו לאשר את ההזמנה. נסו שוב.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'נסו שוב' }));

    await waitFor(() => expect(screen.getByText('home')).toBeInTheDocument());
    expect(attemptRefresh).toHaveBeenCalledTimes(2);
    expect(acceptInvitation).toHaveBeenCalledOnce();
  });

  // CAR-118 review item 3: `already_member` must not navigate off whatever
  // `useAuth()` happened to hold before this click — it reconciles first,
  // the same as a fresh 'ok' does.
  it('reconciles the session before navigating on already_member, landing on the business interface', async () => {
    mockAuth({ status: 'authenticated' });
    vi.mocked(previewInvitation).mockResolvedValue({ outcome: 'ok', invitation: PREVIEW });
    vi.mocked(acceptInvitation).mockResolvedValue({ outcome: 'already_member' });
    vi.mocked(attemptRefresh).mockImplementation(resolvedSingleBusiness);

    renderAt('/business-invite#TXQ947ZKPS');
    await waitFor(() => expect(screen.getByRole('button', { name: 'אישור ההזמנה' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'אישור ההזמנה' }));

    await waitFor(() => expect(attemptRefresh).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByText('home')).toBeInTheDocument());
  });

  // CAR-118 review item 4: this branch never touched the invitation, so it
  // must never borrow the "invitation accepted" wording an actual accept
  // uses for the same ambiguous shape.
  it('shows the already-member-specific ambiguous state, never the accepted-invitation wording, when already_member reconciles to an account tied to another business too', async () => {
    mockAuth({ status: 'authenticated' });
    vi.mocked(previewInvitation).mockResolvedValue({ outcome: 'ok', invitation: PREVIEW });
    vi.mocked(acceptInvitation).mockResolvedValue({ outcome: 'already_member' });
    vi.mocked(attemptRefresh).mockImplementation(resolvedAmbiguous);

    renderAt('/business-invite#TXQ947ZKPS');
    await waitFor(() => expect(screen.getByRole('button', { name: 'אישור ההזמנה' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'אישור ההזמנה' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'כבר יש לכם גישה' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'התנתקות' })).toBeInTheDocument();
    expect(screen.queryByText('ההזמנה אושרה')).not.toBeInTheDocument();
  });

  // CAR-118 review item 4: distinct from the true-ambiguous case above — the
  // account resolves cleanly to exactly one *other* business (e.g. the
  // invited membership was revoked and reassigned between the server's
  // ALREADY_MEMBER answer and this refresh), so it must never be told
  // "you already have access to this business", which would be false.
  it('shows the incompatible-business state, never "already have access", when already_member reconciles to a different resolved business', async () => {
    mockAuth({ status: 'authenticated' });
    vi.mocked(previewInvitation).mockResolvedValue({ outcome: 'ok', invitation: PREVIEW });
    vi.mocked(acceptInvitation).mockResolvedValue({ outcome: 'already_member' });
    vi.mocked(attemptRefresh).mockImplementation(resolvedDifferentBusiness);

    renderAt('/business-invite#TXQ947ZKPS');
    await waitFor(() => expect(screen.getByRole('button', { name: 'אישור ההזמנה' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'אישור ההזמנה' }));

    await waitFor(() => expect(screen.getByText('ההזמנה הזו שייכת לעסק אחר')).toBeInTheDocument());
    expect(screen.queryByText('כבר יש לכם גישה')).not.toBeInTheDocument();
    expect(screen.queryByText('ההזמנה אושרה')).not.toBeInTheDocument();
  });

  // The mirror case: if the invited membership was somehow removed between
  // the server's ALREADY_MEMBER answer and this reconciliation, the account
  // is cleanly not a member — never shown as accepted or already-accessible,
  // and the invitation (never touched by this branch) remains safe to try.
  it('returns to the safe-to-attempt state when already_member reconciles to no matching membership at all', async () => {
    mockAuth({ status: 'authenticated' });
    vi.mocked(previewInvitation).mockResolvedValue({ outcome: 'ok', invitation: PREVIEW });
    vi.mocked(acceptInvitation).mockResolvedValue({ outcome: 'already_member' });
    vi.mocked(attemptRefresh).mockImplementation(resolvedNoBusiness);

    renderAt('/business-invite#TXQ947ZKPS');
    await waitFor(() => expect(screen.getByRole('button', { name: 'אישור ההזמנה' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'אישור ההזמנה' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'אישור ההזמנה' })).toBeInTheDocument());
    expect(screen.queryByText('ההזמנה אושרה')).not.toBeInTheDocument();
    expect(screen.queryByText('כבר יש לכם גישה')).not.toBeInTheDocument();
  });

  // CAR-118 review item 1: a lost response never proves the mutation didn't
  // land. Both 'invalid' and the two indeterminate outcomes reconcile
  // against the invitation's own preview businessId before deciding
  // anything — a clean reconciliation showing that business is what "this
  // account genuinely never redeemed this token" looks like.
  it('renders the same invalid-invitation message when accept answers invalid and reconciliation confirms no matching membership', async () => {
    mockAuth({ status: 'authenticated' });
    vi.mocked(previewInvitation).mockResolvedValue({ outcome: 'ok', invitation: PREVIEW });
    vi.mocked(acceptInvitation).mockResolvedValue({ outcome: 'invalid' });
    vi.mocked(attemptRefresh).mockImplementation(resolvedNoBusiness);

    renderAt('/business-invite#TXQ947ZKPS');
    await waitFor(() => expect(screen.getByRole('button', { name: 'אישור ההזמנה' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'אישור ההזמנה' }));

    await waitFor(() => expect(screen.getByText('ההזמנה אינה תקפה')).toBeInTheDocument());
    expect(attemptRefresh).toHaveBeenCalledOnce();
  });

  it('lands on the business interface, not an indeterminate or failure state, when a lost accept response actually committed on the server', async () => {
    mockAuth({ status: 'authenticated' });
    vi.mocked(previewInvitation).mockResolvedValue({ outcome: 'ok', invitation: PREVIEW });
    // The response never reached the client, but the mutation landed —
    // reconciliation is how the client finds out, not the (missing) response.
    vi.mocked(acceptInvitation).mockResolvedValue({ outcome: 'network_error' });
    vi.mocked(attemptRefresh).mockImplementation(resolvedSingleBusiness);

    renderAt('/business-invite#TXQ947ZKPS');
    await waitFor(() => expect(screen.getByRole('button', { name: 'אישור ההזמנה' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'אישור ההזמנה' }));

    await waitFor(() => expect(screen.getByText('home')).toBeInTheDocument());
    expect(screen.queryByText('לא הצלחנו לוודא את סטטוס ההזמנה')).not.toBeInTheDocument();
    expect(acceptInvitation).toHaveBeenCalledOnce();
  });

  // CAR-118 review item 2: an indeterminate accept response that reconciles
  // to "conclusively not a member yet" must never leave the user stuck on a
  // dead-end screen — it returns to the exact same, ordinary accept button,
  // safe to press again.
  it('returns to the safe-to-attempt state — never a claim of failure, never stuck — when accept fails unexpectedly and reconciliation confirms nothing was redeemed', async () => {
    mockAuth({ status: 'authenticated' });
    vi.mocked(previewInvitation).mockResolvedValue({ outcome: 'ok', invitation: PREVIEW });
    vi.mocked(acceptInvitation).mockResolvedValue({ outcome: 'unexpected_error' });
    vi.mocked(attemptRefresh).mockImplementation(resolvedNoBusiness);

    renderAt('/business-invite#TXQ947ZKPS');
    await waitFor(() => expect(screen.getByRole('button', { name: 'אישור ההזמנה' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'אישור ההזמנה' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'אישור ההזמנה' })).toBeInTheDocument());
    expect(screen.queryByText('ההזמנה אושרה')).not.toBeInTheDocument();
    expect(screen.queryByText('לא הצלחנו לאשר')).not.toBeInTheDocument();
  });

  it('a second click from the safe-to-attempt state re-attempts accept exactly once more, landing on the business interface once it actually succeeds', async () => {
    mockAuth({ status: 'authenticated' });
    vi.mocked(previewInvitation).mockResolvedValue({ outcome: 'ok', invitation: PREVIEW });
    vi.mocked(acceptInvitation)
      .mockResolvedValueOnce({ outcome: 'unexpected_error' })
      .mockResolvedValueOnce({ outcome: 'ok', membership: MEMBERSHIP });
    vi.mocked(attemptRefresh).mockImplementationOnce(resolvedNoBusiness).mockImplementationOnce(resolvedSingleBusiness);

    renderAt('/business-invite#TXQ947ZKPS');
    await waitFor(() => expect(screen.getByRole('button', { name: 'אישור ההזמנה' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'אישור ההזמנה' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'אישור ההזמנה' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'אישור ההזמנה' }));

    await waitFor(() => expect(screen.getByText('home')).toBeInTheDocument());
    expect(acceptInvitation).toHaveBeenCalledTimes(2);
  });

  // CAR-118 review item 2: an account already resolved to a different
  // business must never be allowed to consume the invitation at all — the
  // mutation cannot be undone once it lands, and this portal cannot place
  // the account into two businesses.
  it('blocks acceptance and never calls acceptInvitation for an account already tied to a different business', async () => {
    mockAuth({
      status: 'authenticated',
      user: { ...BASE_USER, businessId: 'other-business', businessMembershipRole: 'CASHIER', businessMembershipAmbiguous: false },
    });
    vi.mocked(previewInvitation).mockResolvedValue({ outcome: 'ok', invitation: PREVIEW });

    renderAt('/business-invite#TXQ947ZKPS');

    await waitFor(() => expect(screen.getByText('ההזמנה הזו שייכת לעסק אחר')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'אישור ההזמנה' })).not.toBeInTheDocument();
    expect(acceptInvitation).not.toHaveBeenCalled();
  });

  it('preserves a recoverable path to the invitation from the incompatible-business state — signing out returns to sign-in carrying the same token forward', async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    mockAuth({
      status: 'authenticated',
      logout,
      user: { ...BASE_USER, businessMembershipAmbiguous: true },
    });
    vi.mocked(previewInvitation).mockResolvedValue({ outcome: 'ok', invitation: PREVIEW });

    renderAt('/business-invite#TXQ947ZKPS', [{ path: '/sign-in', element: <FromProbe /> }]);

    await waitFor(() => expect(screen.getByText('ההזמנה הזו שייכת לעסק אחר')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'התנתקות' }));

    await waitFor(() => expect(logout).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByText('from: /business-invite#TXQ947ZKPS')).toBeInTheDocument());
    expect(acceptInvitation).not.toHaveBeenCalled();
  });

  it('does not block acceptance for an account already a member of the same business the invitation names', async () => {
    mockAuth({
      status: 'authenticated',
      user: { ...BASE_USER, businessId: 'b1', businessMembershipRole: 'CASHIER', businessMembershipAmbiguous: false },
    });
    vi.mocked(previewInvitation).mockResolvedValue({ outcome: 'ok', invitation: PREVIEW });

    renderAt('/business-invite#TXQ947ZKPS');

    await waitFor(() => expect(screen.getByRole('button', { name: 'אישור ההזמנה' })).toBeInTheDocument());
    expect(screen.queryByText('ההזמנה הזו שייכת לעסק אחר')).not.toBeInTheDocument();
  });

  // CAR-118 review item 3: a race can let the click through before the
  // client-side pre-check's own picture was fresh — the server's own
  // refusal must land on the exact same incompatible-business state, not a
  // failure or indeterminate one.
  it('shows the incompatible-business state when the server itself refuses the direct accept call', async () => {
    mockAuth({ status: 'authenticated' });
    vi.mocked(previewInvitation).mockResolvedValue({ outcome: 'ok', invitation: PREVIEW });
    vi.mocked(acceptInvitation).mockResolvedValue({ outcome: 'incompatible_business' });

    renderAt('/business-invite#TXQ947ZKPS');
    await waitFor(() => expect(screen.getByRole('button', { name: 'אישור ההזמנה' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'אישור ההזמנה' }));

    await waitFor(() => expect(screen.getByText('ההזמנה הזו שייכת לעסק אחר')).toBeInTheDocument());
    // Server-confirmed and final — no reconciliation needed to know nothing
    // was consumed, unlike the indeterminate outcomes above.
    expect(attemptRefresh).not.toHaveBeenCalled();
  });

  // CAR-118 review item 5: there is no legacy link shape to stay compatible
  // with (CAR-118 has never been deployed) — only the canonical fragment
  // route exists, so a malformed or unsupported fragment must reach the
  // normal invalid state without ever asking the server or crashing render.
  describe('malformed fragments', () => {
    it('reaches the normal invalid-invitation state for a malformed fragment, without crashing', async () => {
      mockAuth({ status: 'authenticated' });

      renderAt('/business-invite#%');

      await waitFor(() => expect(screen.getByText('ההזמנה אינה תקפה')).toBeInTheDocument());
      expect(previewInvitation).not.toHaveBeenCalled();
    });

    it('reaches the normal invalid-invitation state for an empty fragment, without crashing', async () => {
      mockAuth({ status: 'authenticated' });

      renderAt('/business-invite');

      await waitFor(() => expect(screen.getByText('ההזמנה אינה תקפה')).toBeInTheDocument());
      expect(previewInvitation).not.toHaveBeenCalled();
    });

    it('reaches the normal invalid-invitation state for a fragment that decodes but does not match the token shape, without ever asking the server', async () => {
      mockAuth({ status: 'authenticated' });

      renderAt('/business-invite#not-a-real-token');

      await waitFor(() => expect(screen.getByText('ההזמנה אינה תקפה')).toBeInTheDocument());
      expect(previewInvitation).not.toHaveBeenCalled();
    });
  });

  // CAR-118 review item 1: a delayed preview response must never let one
  // invitation's details render while a different invitation's token is what
  // Accept would actually submit.
  describe('a token change while a preview is in flight', () => {
    it('clears the previous invitation immediately and never lets a stale preview bind to a later accept', async () => {
      mockAuth({ status: 'authenticated' });
      const previewB: InvitationPreview = {
        businessId: 'b2',
        businessName: 'Other Business',
        role: 'cashier',
        expiresAt: '2026-09-01T00:00:00Z',
      };
      let resolveA: (result: Awaited<ReturnType<typeof previewInvitation>>) => void = () => {};
      let resolveB: (result: Awaited<ReturnType<typeof previewInvitation>>) => void = () => {};
      vi.mocked(previewInvitation).mockImplementation((token) => {
        if (token === 'TXQ947ZKPS') return new Promise((resolve) => (resolveA = resolve));
        if (token === 'ZZZZZ22222') return new Promise((resolve) => (resolveB = resolve));
        throw new Error(`unexpected token in test: ${token}`);
      });
      vi.mocked(acceptInvitation).mockResolvedValue({ outcome: 'ok', membership: { businessId: 'b2', role: 'cashier' } });

      const router = createMemoryRouter(
        [
          { path: '/business-invite', element: <AcceptInvitationPage /> },
          { path: '/', element: <div>home</div> },
        ],
        { initialEntries: ['/business-invite#TXQ947ZKPS'] },
      );
      render(
        <LanguageProvider>
          <RouterProvider router={router} />
        </LanguageProvider>,
      );

      await waitFor(() => expect(previewInvitation).toHaveBeenCalledWith('TXQ947ZKPS'));
      resolveA({ outcome: 'ok', invitation: PREVIEW });
      await waitFor(() => expect(screen.getByText('Aroma Israel')).toBeInTheDocument());

      // The fragment changes to a different invitation while B's preview is
      // still pending — A's details must vanish at once, and the accept
      // form (which would otherwise submit A's now-stale token) with it.
      router.navigate('/business-invite#ZZZZZ22222');

      await waitFor(() => expect(screen.queryByText('Aroma Israel')).not.toBeInTheDocument());
      expect(screen.queryByRole('button', { name: 'אישור ההזמנה' })).not.toBeInTheDocument();

      resolveB({ outcome: 'ok', invitation: previewB });
      await waitFor(() => expect(screen.getByText('Other Business')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: 'אישור ההזמנה' }));

      await waitFor(() => expect(acceptInvitation).toHaveBeenCalledExactlyOnceWith('ZZZZZ22222'));
    });
  });
});
