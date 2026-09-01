import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { AuthProvider } from '@/lib/auth/AuthProvider';
import { authApi, AuthApiError } from '@/lib/auth/authApi';
import { setSession } from '@/lib/auth/session';
import { listRewards } from '@/lib/api/rewards';
import { listMembers, changeMemberRole, revokeMemberAccess } from '@/lib/api/businessMembers';
import { listInvitations, previewInvitation, acceptInvitation } from '@/lib/api/businessInvitations';
import { listBusinessRequests } from '@/lib/api/businessRequests';
import { routes } from './router';

vi.mock('@/lib/auth/authApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/authApi')>();
  return { ...actual, authApi: { refresh: vi.fn(), login: vi.fn(), logout: vi.fn(), register: vi.fn() } };
});

vi.mock('@/lib/api/rewards', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/rewards')>();
  return { ...actual, listRewards: vi.fn() };
});

vi.mock('@/lib/api/businessMembers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/businessMembers')>();
  return { ...actual, listMembers: vi.fn(), changeMemberRole: vi.fn(), revokeMemberAccess: vi.fn() };
});

vi.mock('@/lib/api/businessInvitations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/businessInvitations')>();
  return { ...actual, listInvitations: vi.fn(), previewInvitation: vi.fn(), acceptInvitation: vi.fn() };
});

vi.mock('@/lib/api/businessRequests', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/businessRequests')>();
  return { ...actual, listBusinessRequests: vi.fn() };
});

const businessUser = {
  id: '1',
  name: 'Dana Levi',
  email: null,
  role: 'BUSINESS' as const,
  businessId: 'b1',
  businessCategory: 'food',
  businessName: 'Aroma Israel',
  businessNameHe: null,
  businessMembershipRole: null,
  businessMembershipAmbiguous: false,
};

const ownerUser = { ...businessUser, businessMembershipRole: 'OWNER' as const };
const managerUser = { ...businessUser, businessMembershipRole: 'MANAGER' as const };
const cashierUser = { ...businessUser, businessMembershipRole: 'CASHIER' as const };
// No membership, or more than one (CAR-258 fails closed rather than
// guessing which business/role applies) — both leave businessMembershipRole
// null, and CAR-116 requires every business route to refuse both alike.
const ambiguousUser = { ...businessUser, businessMembershipRole: null, businessMembershipAmbiguous: true };

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(
    <LanguageProvider>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </LanguageProvider>,
  );
}

describe('routes', () => {
  beforeEach(() => {
    setSession(null);
    vi.mocked(authApi.refresh).mockReset();
    vi.mocked(listRewards).mockReset();
    vi.mocked(listMembers).mockReset();
    vi.mocked(changeMemberRole).mockReset();
    vi.mocked(revokeMemberAccess).mockReset();
    vi.mocked(listInvitations).mockReset();
    vi.mocked(previewInvitation).mockReset();
    vi.mocked(acceptInvitation).mockReset();
    vi.mocked(listBusinessRequests).mockReset();
  });

  // CAR-255: an ADMIN reaches the review page even with no business
  // membership at all — ADMIN is a system role, not gated by
  // `RequireBusinessRole`/CAR-258's membership resolution.
  const adminUser = {
    id: 'admin-1',
    name: 'Admin',
    email: 'admin@example.com',
    role: 'ADMIN' as const,
    businessId: null,
    businessCategory: null,
    businessName: null,
    businessNameHe: null,
    businessMembershipRole: null,
    businessMembershipAmbiguous: false,
  };

  it('renders the real business-requests review page inside the shell at /admin/business-requests for an ADMIN', async () => {
    vi.mocked(authApi.refresh).mockResolvedValue({ token: 'tok', user: adminUser });
    vi.mocked(listBusinessRequests).mockResolvedValue({ outcome: 'ok', requests: [] });

    renderAt('/admin/business-requests');

    await waitFor(() => expect(screen.getByRole('heading', { name: 'בקשות הצטרפות עסקים' })).toBeInTheDocument());
    expect(listBusinessRequests).toHaveBeenCalledExactlyOnceWith('pending');
  });

  it('fails closed at /admin/business-requests for an ordinary business OWNER, and never calls the admin API', async () => {
    vi.mocked(authApi.refresh).mockResolvedValue({ token: 'tok', user: ownerUser });

    renderAt('/admin/business-requests');

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: 'בקשות הצטרפות עסקים' })).not.toBeInTheDocument();
    expect(listBusinessRequests).not.toHaveBeenCalled();
  });

  // CAR-255 review: a fresh sign-in with no `from` location state lands
  // every role at / (see SignInPage's default) — an ADMIN has no business
  // membership to show a dashboard for, so it must not dead-end on
  // RequireBusinessRole's access-restricted state the way it did before
  // LandingRoute took over its own role check.
  it('redirects an ADMIN landing at / straight to the business-requests review page, not an access-restricted dead end', async () => {
    vi.mocked(authApi.refresh).mockResolvedValue({ token: 'tok', user: adminUser });
    vi.mocked(listBusinessRequests).mockResolvedValue({ outcome: 'ok', requests: [] });

    renderAt('/');

    await waitFor(() => expect(screen.getByRole('heading', { name: 'בקשות הצטרפות עסקים' })).toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders the home page inside the shell at / for an OWNER once a restored session bootstraps (default language: Hebrew)', async () => {
    vi.mocked(authApi.refresh).mockResolvedValue({ token: 'tok', user: ownerUser });

    renderAt('/');

    // Not `getByText` — the redeem CTA carries the same copy as the heading.
    await waitFor(() => expect(screen.getByRole('heading', { name: 'מימוש הטבה' })).toBeInTheDocument());
    // Shell chrome: business identity from the session, not hardcoded.
    expect(screen.getByText('Aroma Israel')).toBeInTheDocument();
  });

  // CAR-116: a CASHIER has no use for the dashboard — / sends it straight to
  // the one screen its role actually needs.
  it('sends a CASHIER landing at / straight to the redemption page, not the home page', async () => {
    vi.mocked(authApi.refresh).mockResolvedValue({ token: 'tok', user: cashierUser });

    renderAt('/');

    // Home and Redemption share the same heading copy (see the sign-in-vs-
    // heading comment below) — the voucher-code field is RedemptionPage's
    // own unambiguous marker; HomePage never renders one.
    await waitFor(() => expect(screen.getByLabelText('קוד שובר')).toBeInTheDocument());
  });

  // CAR-258 fails closed rather than guessing a business/role for a caller
  // with no membership or more than one — CAR-116 must not render any
  // business content for that state either, direct URL included.
  it('fails closed at / when the membership role is null (no membership, or ambiguous)', async () => {
    vi.mocked(authApi.refresh).mockResolvedValue({ token: 'tok', user: ambiguousUser });

    renderAt('/');

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: 'מימוש הטבה' })).not.toBeInTheDocument();
  });

  it('sends / to sign-in when there is no session to restore', async () => {
    vi.mocked(authApi.refresh).mockRejectedValue(new AuthApiError(401, 'Session expired — sign in again'));

    renderAt('/');

    // Not `getByText('התחברות')` — it matches both the page heading and the
    // submit button. The email field is the unambiguous sign-in-page marker.
    await waitFor(() => expect(screen.getByLabelText('אימייל')).toBeInTheDocument());
  });

  // 404 sits outside the role gate on purpose (CAR-116) — an unknown path is
  // not a permission question, so a null/ambiguous membership must not turn
  // it into an access-restricted state either. `businessUser` here still
  // carries no membership role at all.
  it('renders the not-found page inside the shell at an unknown path regardless of membership role (default language: Hebrew)', async () => {
    vi.mocked(authApi.refresh).mockResolvedValue({ token: 'tok', user: businessUser });

    renderAt('/does-not-exist');

    await waitFor(() => expect(screen.getByText('הדף לא נמצא')).toBeInTheDocument());
    // Still inside the shell — the sidebar's business identity is present.
    expect(screen.getByText('Aroma Israel')).toBeInTheDocument();
    // AppShell owns the page's one <main> landmark — NotFoundPage must not
    // add a second, nested one when rendered inside it.
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  it('renders the coming-soon placeholder for a core route whose own ticket has not landed', async () => {
    vi.mocked(authApi.refresh).mockResolvedValue({ token: 'tok', user: ownerUser });

    renderAt('/business-profile');

    // Not `getByText` — the sidebar's own disabled nav items carry the same
    // "coming soon" badge copy. The heading is the page-level marker.
    await waitFor(() => expect(screen.getByRole('heading', { name: 'בקרוב' })).toBeInTheDocument());
  });

  it('renders the real rewards page inside the shell at /rewards for an OWNER (CAR-202)', async () => {
    vi.mocked(authApi.refresh).mockResolvedValue({ token: 'tok', user: ownerUser });
    vi.mocked(listRewards).mockResolvedValue({ outcome: 'ok', rewards: [] });

    renderAt('/rewards');

    await waitFor(() => expect(screen.getByRole('heading', { name: 'הטבות' })).toBeInTheDocument());
    // Still inside the shell.
    expect(screen.getByText('Aroma Israel')).toBeInTheDocument();
  });

  it('renders the real rewards page inside the shell at /rewards for a MANAGER too (CAR-202)', async () => {
    vi.mocked(authApi.refresh).mockResolvedValue({ token: 'tok', user: managerUser });
    vi.mocked(listRewards).mockResolvedValue({ outcome: 'ok', rewards: [] });

    renderAt('/rewards');

    await waitFor(() => expect(screen.getByRole('heading', { name: 'הטבות' })).toBeInTheDocument());
  });

  // CAR-116: CASHIER now gets the active-rewards view the matrix grants it —
  // CAR-202's original all-or-nothing block only covered OWNER/MANAGER.
  it('renders the rewards page for a CASHIER with the server-filtered list, but no manage controls', async () => {
    vi.mocked(authApi.refresh).mockResolvedValue({ token: 'tok', user: cashierUser });
    vi.mocked(listRewards).mockResolvedValue({ outcome: 'ok', rewards: [] });

    renderAt('/rewards');

    await waitFor(() => expect(screen.getByRole('heading', { name: 'הטבות' })).toBeInTheDocument());
    expect(listRewards).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'הטבה חדשה' })).not.toBeInTheDocument();
  });

  it('fails closed at /rewards when the membership role is null (no membership, or ambiguous), and never calls the rewards API', async () => {
    vi.mocked(authApi.refresh).mockResolvedValue({ token: 'tok', user: ambiguousUser });

    renderAt('/rewards');

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: 'הטבות' })).not.toBeInTheDocument();
    expect(listRewards).not.toHaveBeenCalled();
  });

  it('renders the real redemption page inside the shell at /redemption (CAR-68)', async () => {
    vi.mocked(authApi.refresh).mockResolvedValue({ token: 'tok', user: ownerUser });

    renderAt('/redemption');

    await waitFor(() => expect(screen.getByLabelText('קוד שובר')).toBeInTheDocument());
    // Still inside the shell.
    expect(screen.getByText('Aroma Israel')).toBeInTheDocument();
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  // CAR-117: /permissions has its own, narrower `RequireBusinessRole` — OWNER
  // only, unlike the four routes above that every role in the matrix reaches.
  // These four run before the /register tests below on purpose: those two
  // leave `authApi.refresh` returning a promise that never resolves, and
  // `lib/auth/refresh.ts`'s single-flight `inFlight` guard is module-scoped —
  // once set from an unresolved call it never clears, so every later test in
  // this file that (like these, via `AuthProvider`'s own bootstrap) calls
  // `attemptRefresh()` would hang on the same stuck promise.
  it('renders the real permissions page inside the shell at /permissions for an OWNER', async () => {
    vi.mocked(authApi.refresh).mockResolvedValue({ token: 'tok', user: ownerUser });
    vi.mocked(listMembers).mockResolvedValue({ outcome: 'ok', members: [] });

    renderAt('/permissions');

    await waitFor(() => expect(screen.getByRole('heading', { name: 'הרשאות מימוש הטבות' })).toBeInTheDocument());
    expect(screen.getByText('Aroma Israel')).toBeInTheDocument();
  });

  it('fails closed at /permissions for a MANAGER, and never calls the members API', async () => {
    vi.mocked(authApi.refresh).mockResolvedValue({ token: 'tok', user: managerUser });

    renderAt('/permissions');

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: 'הרשאות מימוש הטבות' })).not.toBeInTheDocument();
    expect(listMembers).not.toHaveBeenCalled();
  });

  it('fails closed at /permissions for a CASHIER, and never calls the members API', async () => {
    vi.mocked(authApi.refresh).mockResolvedValue({ token: 'tok', user: cashierUser });

    renderAt('/permissions');

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(listMembers).not.toHaveBeenCalled();
  });

  it('a direct URL to /permissions is refused for a null/ambiguous membership too', async () => {
    vi.mocked(authApi.refresh).mockResolvedValue({ token: 'tok', user: ambiguousUser });

    renderAt('/permissions');

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(listMembers).not.toHaveBeenCalled();
  });

  // CAR-117 review finding: a self-demotion must update the *shared* session
  // — not just the page's own local state — so both the page and AppShell's
  // OWNER-only nav link transition together, even when the reconciling
  // `attemptRefresh()` call settles to 'transient' (refresh.ts deliberately
  // leaves session state untouched on that outcome). Real `AuthProvider` and
  // the real session store here — only `authApi`/`listMembers`/
  // `changeMemberRole` are mocked — so this exercises the actual shared-state
  // path both AppShell and RequireBusinessRole read, not a stand-in for it.
  it('self-demotion updates both the page and the OWNER-only nav link, even when the reconciling refresh is only transient', async () => {
    vi.mocked(authApi.refresh).mockResolvedValueOnce({ token: 'tok', user: ownerUser });
    vi.mocked(listMembers).mockResolvedValue({
      outcome: 'ok',
      members: [
        { id: 'mSelf', userId: ownerUser.id, name: 'Dana Levi', email: null, role: 'OWNER', joinedAt: '2026-01-01T00:00:00Z' },
      ],
    });
    vi.mocked(changeMemberRole).mockResolvedValue({
      outcome: 'ok',
      member: { id: 'mSelf', userId: ownerUser.id, name: 'Dana Levi', email: null, role: 'MANAGER', joinedAt: '2026-01-01T00:00:00Z' },
    });
    // A non-401 failure on the *second* authApi.refresh call — the one
    // `reconcileSelfSession` triggers after the mutation — maps to
    // 'transient' in refresh.ts, which leaves session state untouched.
    vi.mocked(authApi.refresh).mockRejectedValueOnce(new AuthApiError(500, 'Server error'));

    renderAt('/permissions');

    await waitFor(() => expect(screen.getByRole('heading', { name: 'הרשאות מימוש הטבות' })).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'צוות והרשאות' })).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'MANAGER' } });

    await waitFor(() => expect(changeMemberRole).toHaveBeenCalledExactlyOnceWith('mSelf', 'MANAGER'));
    // AppShell reads the same shared session `patchOwnSessionRole` just
    // updated — the nav link must disappear on this same update, not only
    // once (or if) the background refresh call happens to succeed.
    await waitFor(() => expect(screen.queryByRole('link', { name: 'צוות והרשאות' })).not.toBeInTheDocument());
    // RequireBusinessRole swaps this route's own Outlet for the
    // access-restricted state for the same reason.
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });

  // CAR-118: /permissions/invitations sits under the same OWNER-only
  // RequireBusinessRole as /permissions, not a looser one. Run before the
  // /register tests below on purpose — same reason as the CAR-117 block
  // above: those leave `authApi.refresh` permanently stuck in flight.
  it('renders the real invitations page inside the shell at /permissions/invitations for an OWNER', async () => {
    vi.mocked(authApi.refresh).mockResolvedValue({ token: 'tok', user: ownerUser });
    vi.mocked(listInvitations).mockResolvedValue({ outcome: 'ok', invitations: [] });

    renderAt('/permissions/invitations');

    await waitFor(() => expect(screen.getByRole('heading', { name: 'הזמנות' })).toBeInTheDocument());
    expect(screen.getByText('Aroma Israel')).toBeInTheDocument();
  });

  it('fails closed at /permissions/invitations for a MANAGER, and never calls the invitations API', async () => {
    vi.mocked(authApi.refresh).mockResolvedValue({ token: 'tok', user: managerUser });

    renderAt('/permissions/invitations');

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(listInvitations).not.toHaveBeenCalled();
  });

  it('fails closed at /permissions/invitations for a CASHIER, and never calls the invitations API', async () => {
    vi.mocked(authApi.refresh).mockResolvedValue({ token: 'tok', user: cashierUser });

    renderAt('/permissions/invitations');

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(listInvitations).not.toHaveBeenCalled();
  });

  // CAR-118: an invitation link must work with no session at all — this route
  // sits outside ProtectedRoute, unlike every business route above.
  it('renders the invitation-acceptance page at /business-invite/:token with no session to restore, without redirecting to sign-in', async () => {
    vi.mocked(authApi.refresh).mockRejectedValue(new AuthApiError(401, 'Session expired — sign in again'));

    renderAt('/business-invite#TXQ947ZKPS');

    await waitFor(() => expect(screen.getByText('כבר יש לכם חשבון?')).toBeInTheDocument());
    expect(previewInvitation).not.toHaveBeenCalled();
  });

  it('previews the business and role for an authenticated recipient at /business-invite/:token', async () => {
    vi.mocked(authApi.refresh).mockResolvedValue({ token: 'tok', user: businessUser });
    vi.mocked(previewInvitation).mockResolvedValue({
      outcome: 'ok',
      invitation: { businessId: 'b1', businessName: 'Aroma Israel', role: 'cashier', expiresAt: '2026-09-01T00:00:00Z' },
    });

    renderAt('/business-invite#TXQ947ZKPS');

    await waitFor(() => expect(screen.getByText('Aroma Israel')).toBeInTheDocument());
  });

  // CAR-118: end-to-end through the real `routes` tree, the real
  // `ProtectedRoute`/`RequireBusinessRole`, and the real `AuthProvider` +
  // session store — not a stubbed home element and not a mocked `useAuth()`.
  // Only `authApi.refresh` (what `attemptRefresh()` actually calls) and the
  // `businessInvitations` API boundary are mocked; everything from the
  // accept button click through to what the role guard decides is real.
  const recipientUser = {
    id: 'r1',
    name: 'New Recipient',
    email: 'recipient@example.com',
    role: 'DRIVER' as const,
    businessId: null,
    businessCategory: null,
    businessName: null,
    businessNameHe: null,
    businessMembershipRole: null,
    businessMembershipAmbiguous: false,
  };

  it('accepts the invitation and reaches the real business route for a normal single-membership recipient, without an access-restricted state', async () => {
    // First call is AuthProvider's bootstrap (the recipient signed in before
    // ever landing on the invitation link); second is the post-accept
    // reconciliation, resolving the membership CAR-258's own contract
    // requires — a real, unambiguous role in the invited business.
    vi.mocked(authApi.refresh)
      .mockResolvedValueOnce({ token: 'tok-1', user: recipientUser })
      .mockResolvedValueOnce({
        token: 'tok-2',
        user: { ...recipientUser, businessId: 'b1', businessName: 'Aroma Israel', businessMembershipRole: 'MANAGER' },
      });
    vi.mocked(previewInvitation).mockResolvedValue({
      outcome: 'ok',
      invitation: { businessId: 'b1', businessName: 'Aroma Israel', role: 'manager', expiresAt: '2026-09-01T00:00:00Z' },
    });
    vi.mocked(acceptInvitation).mockResolvedValue({ outcome: 'ok', membership: { businessId: 'b1', role: 'manager' } });

    renderAt('/business-invite#TXQ947ZKPS');
    await waitFor(() => expect(screen.getByRole('button', { name: 'אישור ההזמנה' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'אישור ההזמנה' }));

    // Landed inside the real protected/role-gated tree — the shell renders
    // the newly-resolved business's name, and the role guard never swaps in
    // its access-restricted state for a MANAGER, which `allow` includes.
    await waitFor(() => expect(screen.getByText('Aroma Israel')).toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(acceptInvitation).toHaveBeenCalledExactlyOnceWith('TXQ947ZKPS');
    expect(authApi.refresh).toHaveBeenCalledTimes(2);
  });

  it('accepts the invitation but stays on the dedicated accepted-but-ambiguous state for a recipient whose account is ambiguous, never entering the protected route tree', async () => {
    vi.mocked(authApi.refresh)
      .mockResolvedValueOnce({ token: 'tok-1', user: recipientUser })
      .mockResolvedValueOnce({
        token: 'tok-2',
        user: { ...recipientUser, businessMembershipRole: null, businessMembershipAmbiguous: true },
      });
    vi.mocked(previewInvitation).mockResolvedValue({
      outcome: 'ok',
      invitation: { businessId: 'b1', businessName: 'Aroma Israel', role: 'manager', expiresAt: '2026-09-01T00:00:00Z' },
    });
    vi.mocked(acceptInvitation).mockResolvedValue({ outcome: 'ok', membership: { businessId: 'b1', role: 'manager' } });

    renderAt('/business-invite#TXQ947ZKPS');
    await waitFor(() => expect(screen.getByRole('button', { name: 'אישור ההזמנה' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'אישור ההזמנה' }));

    // Still on AcceptInvitationPage's own dedicated state — never navigated
    // into ProtectedRoute/RequireBusinessRole, so neither the shell nor its
    // access-restricted alert ever mounts.
    await waitFor(() => expect(screen.getByRole('heading', { name: 'ההזמנה אושרה' })).toBeInTheDocument());
    expect(screen.queryByText('Aroma Israel')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(acceptInvitation).toHaveBeenCalledExactlyOnceWith('TXQ947ZKPS');
    expect(authApi.refresh).toHaveBeenCalledTimes(2);
  });

  // CAR-118 review item 4: reconciliation can resolve to a real, unambiguous
  // role in a *different* business than the one this invitation named — a
  // stale invitation preview accepted after the account's membership picture
  // changed elsewhere. This is not the same claim as a true ambiguous
  // account (CAR-258, multiple memberships) — it must never say "accepted"
  // or "you already have access to this business" when the resolved state
  // proves the opposite; it lands on the same truthful incompatible-business
  // state the pre-mutation guard shows, and never navigates into the
  // protected route tree.
  it('shows the truthful incompatible-business state, not the accepted-invitation wording, when reconciliation resolves to a different business than the accepted invitation', async () => {
    vi.mocked(authApi.refresh)
      .mockResolvedValueOnce({ token: 'tok-1', user: recipientUser })
      .mockResolvedValueOnce({
        token: 'tok-2',
        user: {
          ...recipientUser,
          businessId: 'other-business',
          businessName: 'Other Business',
          businessMembershipRole: 'CASHIER',
          businessMembershipAmbiguous: false,
        },
      });
    vi.mocked(previewInvitation).mockResolvedValue({
      outcome: 'ok',
      invitation: { businessId: 'b1', businessName: 'Aroma Israel', role: 'manager', expiresAt: '2026-09-01T00:00:00Z' },
    });
    vi.mocked(acceptInvitation).mockResolvedValue({ outcome: 'ok', membership: { businessId: 'b1', role: 'manager' } });

    renderAt('/business-invite#TXQ947ZKPS');
    await waitFor(() => expect(screen.getByRole('button', { name: 'אישור ההזמנה' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'אישור ההזמנה' }));

    await waitFor(() => expect(screen.getByText('ההזמנה הזו שייכת לעסק אחר')).toBeInTheDocument());
    expect(screen.queryByText('ההזמנה אושרה')).not.toBeInTheDocument();
    expect(screen.queryByText('Other Business')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(acceptInvitation).toHaveBeenCalledOnce();
  });

  // CAR-118 review's bounded-correction round, item 3: durable recovery
  // after a committed accept response is lost — real route/session
  // integration through the actual SignInPage form and AuthProvider, not a
  // mocked useAuth(). The membership already exists server-side by the time
  // the recipient signs back in; the recovery path must reach it, not
  // dead-end into "invalid invitation".
  it('recovers after a lost accept response once the recipient signs back in, replaying the accept safely', async () => {
    vi.mocked(authApi.refresh)
      .mockResolvedValueOnce({ token: 'tok-1', user: recipientUser }) // bootstrap
      .mockRejectedValueOnce(new AuthApiError(401, 'Session expired — sign in again')); // post-accept reconciliation, rejected
    vi.mocked(authApi.login).mockResolvedValue({
      token: 'tok-2',
      user: { ...recipientUser, businessId: 'b1', businessName: 'Aroma Israel', businessMembershipRole: 'MANAGER' },
    });
    vi.mocked(previewInvitation).mockResolvedValue({
      outcome: 'ok',
      invitation: { businessId: 'b1', businessName: 'Aroma Israel', role: 'manager', expiresAt: '2026-09-01T00:00:00Z' },
    });
    vi.mocked(acceptInvitation)
      .mockResolvedValueOnce({ outcome: 'network_error' }) // the lost response — committed server-side regardless
      .mockResolvedValueOnce({ outcome: 'ok', membership: { businessId: 'b1', role: 'manager' } }); // the replay

    renderAt('/business-invite#TXQ947ZKPS');
    await waitFor(() => expect(screen.getByRole('button', { name: 'אישור ההזמנה' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'אישור ההזמנה' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'יש להתחבר מחדש' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'התחברות' }));

    await waitFor(() => expect(screen.getByLabelText('אימייל')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('אימייל'), { target: { value: 'recipient@example.com' } });
    fireEvent.change(screen.getByLabelText('סיסמה'), { target: { value: 'whatever' } });
    fireEvent.click(screen.getByRole('button', { name: 'התחברות' }));

    // Landed back on the same invitation — preview succeeds again for an
    // invitation this exact recipient already redeemed (the server-side half
    // of durable recovery), showing the ordinary accept form once more
    // rather than a 404 dead end.
    await waitFor(() => expect(screen.getByRole('button', { name: 'אישור ההזמנה' })).toBeInTheDocument());
    // The replay's own reconciliation refresh — a fresh call, distinct from
    // login's own session-establishing response.
    vi.mocked(authApi.refresh).mockResolvedValueOnce({
      token: 'tok-3',
      user: { ...recipientUser, businessId: 'b1', businessName: 'Aroma Israel', businessMembershipRole: 'MANAGER' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'אישור ההזמנה' }));

    // The replay reconciles and lands on the real business route, not a
    // dead end and not a second, blind mutation.
    await waitFor(() => expect(screen.getByText('Aroma Israel')).toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(acceptInvitation).toHaveBeenCalledTimes(2);
  });

  // The same recovery, but simulating a hard reload rather than a sign-in
  // detour: the in-memory session (never persisted — see `lib/auth/session.ts`)
  // is gone, exactly as it would be after an actual page reload, and the
  // whole tree remounts fresh at the same fragment URL, which does survive a
  // reload unlike router state.
  it('recovers after a lost accept response and a hard reload, at the same fragment URL', async () => {
    vi.mocked(authApi.refresh)
      .mockResolvedValueOnce({ token: 'tok-1', user: recipientUser }) // bootstrap
      // Reconciliation right after the failed accept also cannot reach the
      // server — not just the one accept response, the connection itself is
      // down for a moment — which is what actually forces a reload rather
      // than an in-page retry.
      .mockRejectedValueOnce(new AuthApiError(401, 'Session expired — sign in again'));
    vi.mocked(previewInvitation).mockResolvedValue({
      outcome: 'ok',
      invitation: { businessId: 'b1', businessName: 'Aroma Israel', role: 'manager', expiresAt: '2026-09-01T00:00:00Z' },
    });
    vi.mocked(acceptInvitation).mockResolvedValueOnce({ outcome: 'network_error' });

    const { unmount } = renderAt('/business-invite#TXQ947ZKPS');
    await waitFor(() => expect(screen.getByRole('button', { name: 'אישור ההזמנה' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'אישור ההזמנה' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'יש להתחבר מחדש' })).toBeInTheDocument());
    unmount();
    setSession(null);

    vi.mocked(authApi.refresh)
      .mockResolvedValueOnce({
        token: 'tok-2',
        user: { ...recipientUser, businessId: 'b1', businessName: 'Aroma Israel', businessMembershipRole: 'MANAGER' },
      }) // the fresh bootstrap after reload
      .mockResolvedValueOnce({
        token: 'tok-3',
        user: { ...recipientUser, businessId: 'b1', businessName: 'Aroma Israel', businessMembershipRole: 'MANAGER' },
      }); // the replay's own reconciliation refresh
    vi.mocked(acceptInvitation).mockResolvedValueOnce({ outcome: 'ok', membership: { businessId: 'b1', role: 'manager' } });

    renderAt('/business-invite#TXQ947ZKPS');
    await waitFor(() => expect(screen.getByRole('button', { name: 'אישור ההזמנה' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'אישור ההזמנה' }));

    await waitFor(() => expect(screen.getByText('Aroma Israel')).toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  // CAR-203: /register and /register/status must be reachable with no
  // account and no session — unlike every other route above, neither sits
  // under ProtectedRoute, so this must not wait on `authApi.refresh` at all.
  it('renders the public registration form at /register without waiting on the auth bootstrap', () => {
    vi.mocked(authApi.refresh).mockReturnValue(new Promise(() => {})); // never resolves

    renderAt('/register');

    expect(screen.getByRole('heading', { name: 'רישום העסק שלכם' })).toBeInTheDocument();
  });

  it('renders the public status-check page at /register/status without waiting on the auth bootstrap', () => {
    vi.mocked(authApi.refresh).mockReturnValue(new Promise(() => {})); // never resolves

    renderAt('/register/status');

    expect(screen.getByRole('heading', { name: 'בדיקת סטטוס הבקשה' })).toBeInTheDocument();
  });
});
