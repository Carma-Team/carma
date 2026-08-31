import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
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

function renderAt(path: string, extraRoutes: { path: string; element: React.ReactNode }[] = []) {
  const router = createMemoryRouter(
    [
      { path: '/business-invite/:token', element: <AcceptInvitationPage /> },
      { path: '/', element: <div>home</div> },
      { path: '/sign-in', element: <div>sign-in page</div> },
      { path: '/create-account', element: <div>create-account page</div> },
      ...extraRoutes,
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

    renderAt('/business-invite/TXQ947ZKPS');

    await waitFor(() => expect(screen.getByText('כבר יש לכם חשבון?')).toBeInTheDocument());
    expect(screen.getByText('עדיין אין לכם חשבון?')).toBeInTheDocument();
    expect(previewInvitation).not.toHaveBeenCalled();
  });

  it('carries the invitation link forward through the sign-in detour, landing back on the same invitation', async () => {
    mockAuth({ status: 'unauthenticated' });

    renderAt('/business-invite/TXQ947ZKPS');
    await waitFor(() => expect(screen.getByRole('button', { name: 'התחברות' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'התחברות' }));

    await waitFor(() => expect(screen.getByText('sign-in page')).toBeInTheDocument());
  });

  it('carries the invitation link forward through the create-account detour', async () => {
    mockAuth({ status: 'unauthenticated' });

    renderAt('/business-invite/TXQ947ZKPS');
    await waitFor(() => expect(screen.getByRole('button', { name: 'יצירת חשבון' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'יצירת חשבון' }));

    await waitFor(() => expect(screen.getByText('create-account page')).toBeInTheDocument());
  });

  it('shows the business and role before any acceptance, for an authenticated recipient', async () => {
    mockAuth({ status: 'authenticated' });
    vi.mocked(previewInvitation).mockResolvedValue({ outcome: 'ok', invitation: PREVIEW });

    renderAt('/business-invite/TXQ947ZKPS');

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

    renderAt('/business-invite/TXQ947ZKPS');

    await waitFor(() => expect(screen.getByText('ההזמנה אינה תקפה')).toBeInTheDocument());
  });

  it('accepts the invitation, reconciles the session, and lands on the business interface for a normal single-membership recipient', async () => {
    mockAuth({ status: 'authenticated' });
    vi.mocked(previewInvitation).mockResolvedValue({ outcome: 'ok', invitation: PREVIEW });
    vi.mocked(acceptInvitation).mockResolvedValue({ outcome: 'ok', membership: MEMBERSHIP });
    vi.mocked(attemptRefresh).mockImplementation(resolvedSingleBusiness);

    renderAt('/business-invite/TXQ947ZKPS');
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

    renderAt('/business-invite/TXQ947ZKPS');
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

    renderAt('/business-invite/TXQ947ZKPS');
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

    renderAt('/business-invite/TXQ947ZKPS');
    await waitFor(() => expect(screen.getByRole('button', { name: 'אישור ההזמנה' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'אישור ההזמנה' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'ההזמנה אושרה' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'התנתקות' }));

    await waitFor(() => expect(logout).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByText('sign-in page')).toBeInTheDocument());
  });

  // A 'rejected' outcome means the session is genuinely gone — but the
  // membership itself was already created before reconciliation even ran,
  // so this must never read as "acceptance failed."
  it('does not claim acceptance failed when session reconciliation is rejected, and offers sign-in instead of re-acceptance', async () => {
    mockAuth({ status: 'authenticated' });
    vi.mocked(previewInvitation).mockResolvedValue({ outcome: 'ok', invitation: PREVIEW });
    vi.mocked(acceptInvitation).mockResolvedValue({ outcome: 'ok', membership: MEMBERSHIP });
    vi.mocked(attemptRefresh).mockResolvedValue('rejected');

    renderAt('/business-invite/TXQ947ZKPS');
    await waitFor(() => expect(screen.getByRole('button', { name: 'אישור ההזמנה' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'אישור ההזמנה' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'ההזמנה אושרה — יש להתחבר מחדש' })).toBeInTheDocument());
    expect(screen.queryByText('לא הצלחנו לאשר את ההזמנה. נסו שוב.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'התחברות' }));
    await waitFor(() => expect(screen.getByText('sign-in page')).toBeInTheDocument());
    expect(acceptInvitation).toHaveBeenCalledOnce();
  });

  // A 'transient' outcome (network/5xx) says nothing about whether the
  // membership or the session are actually fine — retrying must re-check the
  // session, never re-spend the already-consumed token.
  it('does not claim acceptance failed on a transient reconciliation failure, and retrying reconciles without accepting again', async () => {
    mockAuth({ status: 'authenticated' });
    vi.mocked(previewInvitation).mockResolvedValue({ outcome: 'ok', invitation: PREVIEW });
    vi.mocked(acceptInvitation).mockResolvedValue({ outcome: 'ok', membership: MEMBERSHIP });
    vi.mocked(attemptRefresh).mockResolvedValueOnce('transient').mockImplementationOnce(resolvedSingleBusiness);

    renderAt('/business-invite/TXQ947ZKPS');
    await waitFor(() => expect(screen.getByRole('button', { name: 'אישור ההזמנה' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'אישור ההזמנה' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'ההזמנה אושרה' })).toBeInTheDocument());
    expect(screen.queryByText('לא הצלחנו לאשר את ההזמנה. נסו שוב.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'נסו שוב' }));

    await waitFor(() => expect(screen.getByText('home')).toBeInTheDocument());
    expect(attemptRefresh).toHaveBeenCalledTimes(2);
    expect(acceptInvitation).toHaveBeenCalledOnce();
  });

  it('shows a plain already-a-member state without treating it as invalid, and does not reconcile the session', async () => {
    mockAuth({ status: 'authenticated' });
    vi.mocked(previewInvitation).mockResolvedValue({ outcome: 'ok', invitation: PREVIEW });
    vi.mocked(acceptInvitation).mockResolvedValue({ outcome: 'already_member' });

    renderAt('/business-invite/TXQ947ZKPS');
    await waitFor(() => expect(screen.getByRole('button', { name: 'אישור ההזמנה' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'אישור ההזמנה' }));

    await waitFor(() => expect(screen.getByText('כבר יש לכם גישה')).toBeInTheDocument());
    expect(attemptRefresh).not.toHaveBeenCalled();
  });

  it('falls back to the same invalid state if the invitation was consumed between preview and accept', async () => {
    mockAuth({ status: 'authenticated' });
    vi.mocked(previewInvitation).mockResolvedValue({ outcome: 'ok', invitation: PREVIEW });
    vi.mocked(acceptInvitation).mockResolvedValue({ outcome: 'invalid' });

    renderAt('/business-invite/TXQ947ZKPS');
    await waitFor(() => expect(screen.getByRole('button', { name: 'אישור ההזמנה' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'אישור ההזמנה' }));

    await waitFor(() => expect(screen.getByText('ההזמנה אינה תקפה')).toBeInTheDocument());
  });

  it('shows a retryable error state without crashing when acceptance fails unexpectedly', async () => {
    mockAuth({ status: 'authenticated' });
    vi.mocked(previewInvitation).mockResolvedValue({ outcome: 'ok', invitation: PREVIEW });
    vi.mocked(acceptInvitation).mockResolvedValue({ outcome: 'unexpected_error' });

    renderAt('/business-invite/TXQ947ZKPS');
    await waitFor(() => expect(screen.getByRole('button', { name: 'אישור ההזמנה' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'אישור ההזמנה' }));

    await waitFor(() => expect(screen.getByText('לא הצלחנו לאשר את ההזמנה. נסו שוב.')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'אישור ההזמנה' })).toBeEnabled();
  });
});
