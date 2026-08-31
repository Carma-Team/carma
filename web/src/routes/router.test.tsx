import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { AuthProvider } from '@/lib/auth/AuthProvider';
import { authApi, AuthApiError } from '@/lib/auth/authApi';
import { setSession } from '@/lib/auth/session';
import { listRewards } from '@/lib/api/rewards';
import { listMembers, changeMemberRole, revokeMemberAccess } from '@/lib/api/businessMembers';
import { routes } from './router';

vi.mock('@/lib/auth/authApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/authApi')>();
  return { ...actual, authApi: { refresh: vi.fn(), login: vi.fn(), logout: vi.fn() } };
});

vi.mock('@/lib/api/rewards', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/rewards')>();
  return { ...actual, listRewards: vi.fn() };
});

vi.mock('@/lib/api/businessMembers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/businessMembers')>();
  return { ...actual, listMembers: vi.fn(), changeMemberRole: vi.fn(), revokeMemberAccess: vi.fn() };
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
