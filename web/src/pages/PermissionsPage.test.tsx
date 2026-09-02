import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { PermissionsPage } from './PermissionsPage';
import { listMembers, changeMemberRole, revokeMemberAccess } from '@/lib/api/businessMembers';
import type { BusinessMember } from '@/lib/api/businessMembers';
import { attemptRefresh } from '@/lib/auth/refresh';
// Deliberately the *real* module, not mocked: PermissionsPage.tsx patches the
// session through `lib/auth/selfMembership.ts`, itself unmocked here, and the
// most faithful proof that the shared session (what AppShell's nav and
// RequireBusinessRole's route guard both read) actually updates is reading it
// back with the real store, not inferring it through a second layer of mocks.
import { getSession, setSession } from '@/lib/auth/session';

vi.mock('@/lib/api/businessMembers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/businessMembers')>();
  return { ...actual, listMembers: vi.fn(), changeMemberRole: vi.fn(), revokeMemberAccess: vi.fn() };
});

vi.mock('@/lib/auth/refresh', () => ({ attemptRefresh: vi.fn() }));

const mockUseAuth = vi.fn();
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }));

const OWNER_SELF: BusinessMember = {
  id: 'm1',
  userId: 'u-self',
  name: 'Dana Levi',
  email: 'dana@example.com',
  role: 'OWNER',
  joinedAt: '2026-01-01T00:00:00Z',
};

const MANAGER: BusinessMember = {
  id: 'm2',
  userId: 'u-manager',
  name: 'Amir Cohen',
  email: 'amir@example.com',
  role: 'MANAGER',
  joinedAt: '2026-02-01T00:00:00Z',
};

function renderPage() {
  return render(
    <LanguageProvider>
      <MemoryRouter>
        <PermissionsPage />
      </MemoryRouter>
    </LanguageProvider>,
  );
}

describe('PermissionsPage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    }) as unknown as () => void;
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    }) as unknown as (returnValue?: string) => void;
    vi.mocked(listMembers).mockReset();
    vi.mocked(changeMemberRole).mockReset();
    vi.mocked(revokeMemberAccess).mockReset();
    vi.mocked(attemptRefresh).mockReset();
    mockUseAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u-self', name: 'Dana Levi', businessMembershipRole: 'OWNER' },
      login: vi.fn(),
      logout: vi.fn(),
      retry: vi.fn(),
    });
    // Seeds the real session store so `patchOwnSessionRole` has something to
    // patch — `useAuth()` itself is mocked above (fixed per test), so this is
    // the only way these tests can observe the shared session actually
    // changing, independent of that mock.
    setSession({
      accessToken: 'tok',
      user: {
        id: 'u-self',
        name: 'Dana Levi',
        email: 'dana@example.com',
        role: 'BUSINESS',
        businessId: 'b1',
        businessCategory: 'food',
        businessName: 'Aroma Israel',
        businessNameHe: null,
        businessMembershipRole: 'OWNER',
        businessMembershipAmbiguous: false,
      },
    });
  });

  afterEach(() => {
    setSession(null);
    vi.restoreAllMocks();
  });

  it('renders the member list from the API', async () => {
    vi.mocked(listMembers).mockResolvedValue({ outcome: 'ok', members: [OWNER_SELF, MANAGER] });

    renderPage();

    await waitFor(() => expect(screen.getByText('Dana Levi')).toBeInTheDocument());
    expect(screen.getByText('Amir Cohen')).toBeInTheDocument();
    expect(screen.getByText('dana@example.com')).toBeInTheDocument();
    expect(listMembers).toHaveBeenCalledOnce();
  });

  it('shows a plain-language description of each role, not the raw enum value', async () => {
    vi.mocked(listMembers).mockResolvedValue({ outcome: 'ok', members: [MANAGER] });

    renderPage();

    await waitFor(() => expect(screen.getByText('Amir Cohen')).toBeInTheDocument());
    expect(screen.getByText('יכול לממש הטבות ולנהל את קטלוג ההטבות.')).toBeInTheDocument();
    expect(screen.queryByText('MANAGER')).not.toBeInTheDocument();
  });

  it('shows the forbidden state when the server refuses the list', async () => {
    vi.mocked(listMembers).mockResolvedValue({ outcome: 'forbidden' });

    renderPage();

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });

  it('shows an error state with retry when loading fails, and retry re-fetches', async () => {
    vi.mocked(listMembers).mockResolvedValueOnce({ outcome: 'network_error' });
    vi.mocked(listMembers).mockResolvedValueOnce({ outcome: 'ok', members: [MANAGER] });

    renderPage();

    await waitFor(() => expect(screen.getByRole('button', { name: 'נסו שוב' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'נסו שוב' }));

    await waitFor(() => expect(screen.getByText('Amir Cohen')).toBeInTheDocument());
    expect(listMembers).toHaveBeenCalledTimes(2);
  });

  it('sends exactly one mutation when a role is changed, and updates the affected row', async () => {
    vi.mocked(listMembers).mockResolvedValue({ outcome: 'ok', members: [OWNER_SELF, MANAGER] });
    vi.mocked(changeMemberRole).mockResolvedValue({ outcome: 'ok', member: { ...MANAGER, role: 'CASHIER' } });

    renderPage();
    await waitFor(() => expect(screen.getByText('Amir Cohen')).toBeInTheDocument());

    const selects = screen.getAllByRole('combobox');
    // OWNER_SELF renders first (list order from the API), MANAGER second.
    fireEvent.change(selects[1], { target: { value: 'CASHIER' } });

    await waitFor(() => expect(changeMemberRole).toHaveBeenCalledExactlyOnceWith('m2', 'CASHIER'));
    await waitFor(() => expect(selects[1]).toHaveValue('CASHIER'));
  });

  it('does not call attemptRefresh when the mutated member is not the acting owner', async () => {
    vi.mocked(listMembers).mockResolvedValue({ outcome: 'ok', members: [OWNER_SELF, MANAGER] });
    vi.mocked(changeMemberRole).mockResolvedValue({ outcome: 'ok', member: { ...MANAGER, role: 'CASHIER' } });

    renderPage();
    await waitFor(() => expect(screen.getByText('Amir Cohen')).toBeInTheDocument());

    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[1], { target: { value: 'CASHIER' } });

    await waitFor(() => expect(changeMemberRole).toHaveBeenCalledOnce());
    expect(attemptRefresh).not.toHaveBeenCalled();
  });

  // CAR-117: self-demotion when another OWNER exists must patch the shared
  // session immediately — this is what AppShell's nav link and this route's
  // own `RequireBusinessRole` guard both read, so both must reflect the new
  // role right away, not only once a background refresh happens to land.
  it('patches the shared session role the instant the acting owner changes their own role', async () => {
    vi.mocked(listMembers).mockResolvedValue({ outcome: 'ok', members: [OWNER_SELF, MANAGER] });
    vi.mocked(changeMemberRole).mockResolvedValue({ outcome: 'ok', member: { ...OWNER_SELF, role: 'MANAGER' } });
    // Never resolves — proves the session patch does not wait on this.
    vi.mocked(attemptRefresh).mockReturnValue(new Promise(() => {}));

    renderPage();
    await waitFor(() => expect(screen.getByText('Dana Levi')).toBeInTheDocument());

    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'MANAGER' } });

    await waitFor(() => expect(changeMemberRole).toHaveBeenCalledExactlyOnceWith('m1', 'MANAGER'));
    await waitFor(() => expect(getSession()?.user.businessMembershipRole).toBe('MANAGER'));
    // attemptRefresh() is still awaited afterward, for reconciliation, but
    // the session was already correct before it could possibly settle.
    expect(attemptRefresh).toHaveBeenCalledOnce();
  });

  it('shows a plain-language conflict message and leaves the role unchanged when the server refuses the last-OWNER demotion', async () => {
    vi.mocked(listMembers).mockResolvedValue({ outcome: 'ok', members: [OWNER_SELF] });
    vi.mocked(changeMemberRole).mockResolvedValue({ outcome: 'last_owner' });

    renderPage();
    await waitFor(() => expect(screen.getByText('Dana Levi')).toBeInTheDocument());

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'MANAGER' } });

    await waitFor(() => expect(screen.getByText('לעסק חייב תמיד להישאר לפחות בעל אחד.')).toBeInTheDocument());
    expect(screen.getByRole('combobox')).toHaveValue('OWNER');
    expect(attemptRefresh).not.toHaveBeenCalled();
  });

  // Each row's revoke button carries the member's name in its accessible
  // name (`permissions.revokeButtonAriaLabel`) precisely so a row can be
  // targeted unambiguously here — a plain 'ביטול גישה' query would now match
  // every row at once.
  it('revokes a member through the confirm dialog, sending exactly one request', async () => {
    vi.mocked(listMembers).mockResolvedValue({ outcome: 'ok', members: [OWNER_SELF, MANAGER] });
    vi.mocked(revokeMemberAccess).mockResolvedValue({ outcome: 'ok' });

    renderPage();
    await waitFor(() => expect(screen.getByText('Amir Cohen')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'ביטול גישה עבור Amir Cohen' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'לבטל את הגישה?' })).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole('button', { name: 'ביטול גישה עבור Amir Cohen' }).at(-1)!);

    await waitFor(() => expect(revokeMemberAccess).toHaveBeenCalledExactlyOnceWith('m2'));
    await waitFor(() => expect(screen.queryByText('Amir Cohen')).not.toBeInTheDocument());
  });

  it('patches the shared session role to null the instant the acting owner revokes their own access', async () => {
    vi.mocked(listMembers).mockResolvedValue({ outcome: 'ok', members: [OWNER_SELF, MANAGER] });
    vi.mocked(revokeMemberAccess).mockResolvedValue({ outcome: 'ok' });
    vi.mocked(attemptRefresh).mockReturnValue(new Promise(() => {}));

    renderPage();
    await waitFor(() => expect(screen.getByText('Dana Levi')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'ביטול גישה עבור Dana Levi' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'לבטל את הגישה?' })).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole('button', { name: 'ביטול גישה עבור Dana Levi' }).at(-1)!);

    await waitFor(() => expect(revokeMemberAccess).toHaveBeenCalledExactlyOnceWith('m1'));
    // Revoked entirely — no membership role left at all, not just demoted.
    await waitFor(() => expect(getSession()?.user.businessMembershipRole).toBeNull());
    expect(attemptRefresh).toHaveBeenCalledOnce();
  });

  it('shows a plain-language conflict message when revoking the last owner is refused, and keeps the row', async () => {
    vi.mocked(listMembers).mockResolvedValue({ outcome: 'ok', members: [OWNER_SELF] });
    vi.mocked(revokeMemberAccess).mockResolvedValue({ outcome: 'last_owner' });

    renderPage();
    await waitFor(() => expect(screen.getByText('Dana Levi')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'ביטול גישה עבור Dana Levi' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'לבטל את הגישה?' })).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole('button', { name: 'ביטול גישה עבור Dana Levi' }).at(-1)!);

    await waitFor(() => expect(screen.getByText('לעסק חייב תמיד להישאר לפחות בעל אחד.')).toBeInTheDocument());
    expect(screen.getByText('Dana Levi')).toBeInTheDocument();
    expect(attemptRefresh).not.toHaveBeenCalled();
  });

  // CAR-117 review finding: a fix that only re-ran the page's own
  // `listMembers()` call on a 'transient' `attemptRefresh()` outcome left
  // the *shared* session — and AppShell's nav link with it — stale for as
  // long as that follow-up request took, or indefinitely if it never landed
  // either. These three cover every `attemptRefresh()` outcome and prove the
  // session is correct *before* attemptRefresh even settles, so none of them
  // can leave the nav/route-guard stale regardless of the network.
  it.each([
    ['ok', 'ok'],
    ['rejected', 'rejected'],
    ['transient', 'transient'],
  ] as const)(
    'session is already patched to MANAGER for a self-demotion regardless of the attemptRefresh outcome (%s)',
    async (_label, outcome) => {
      vi.mocked(listMembers).mockResolvedValue({ outcome: 'ok', members: [OWNER_SELF] });
      vi.mocked(changeMemberRole).mockResolvedValue({ outcome: 'ok', member: { ...OWNER_SELF, role: 'MANAGER' } });
      vi.mocked(attemptRefresh).mockResolvedValue(outcome);

      renderPage();
      await waitFor(() => expect(screen.getByText('Dana Levi')).toBeInTheDocument());

      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'MANAGER' } });

      await waitFor(() => expect(changeMemberRole).toHaveBeenCalledOnce());
      await waitFor(() => expect(getSession()?.user.businessMembershipRole).toBe('MANAGER'));
      await waitFor(() => expect(attemptRefresh).toHaveBeenCalledOnce());
    },
  );

  it.each([
    ['ok', 'ok'],
    ['rejected', 'rejected'],
    ['transient', 'transient'],
  ] as const)(
    'session is already patched to null for a self-revocation regardless of the attemptRefresh outcome (%s)',
    async (_label, outcome) => {
      vi.mocked(listMembers).mockResolvedValue({ outcome: 'ok', members: [OWNER_SELF] });
      vi.mocked(revokeMemberAccess).mockResolvedValue({ outcome: 'ok' });
      vi.mocked(attemptRefresh).mockResolvedValue(outcome);

      renderPage();
      await waitFor(() => expect(screen.getByText('Dana Levi')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: 'ביטול גישה עבור Dana Levi' }));
      await waitFor(() => expect(screen.getByRole('heading', { name: 'לבטל את הגישה?' })).toBeInTheDocument());
      fireEvent.click(screen.getAllByRole('button', { name: 'ביטול גישה עבור Dana Levi' }).at(-1)!);

      await waitFor(() => expect(revokeMemberAccess).toHaveBeenCalledOnce());
      await waitFor(() => expect(getSession()?.user.businessMembershipRole).toBeNull());
      await waitFor(() => expect(attemptRefresh).toHaveBeenCalledOnce());
    },
  );

  it('renders in Hebrew with RTL by default, and switches to English/LTR copy when the stored language is EN', async () => {
    vi.mocked(listMembers).mockResolvedValue({ outcome: 'ok', members: [OWNER_SELF] });

    const { unmount } = renderPage();
    await waitFor(() => expect(screen.getByText('הרשאות מימוש הטבות')).toBeInTheDocument());
    expect(document.documentElement.dir).toBe('rtl');
    unmount();

    window.localStorage.setItem('carma_lang', 'EN');
    renderPage();
    await waitFor(() => expect(screen.getByText('Voucher-redemption permissions')).toBeInTheDocument());
    expect(document.documentElement.dir).toBe('ltr');
  });

  it("keeps a member's email left-to-right even while the page renders in Hebrew (RTL)", async () => {
    vi.mocked(listMembers).mockResolvedValue({ outcome: 'ok', members: [OWNER_SELF] });

    renderPage();

    await waitFor(() => expect(screen.getByText('dana@example.com')).toBeInTheDocument());
    expect(screen.getByText('dana@example.com')).toHaveAttribute('dir', 'ltr');
  });
});
