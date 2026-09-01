import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { AppShell } from './AppShell';

const logout = vi.fn();
const mockUseAuth = vi.fn();

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

const baseUser = {
  id: '1',
  name: 'Dana Levi',
  email: null,
  role: 'BUSINESS' as const,
  businessId: 'b1',
  businessCategory: 'food',
  businessName: 'Aroma Israel',
  businessNameHe: null,
  businessMembershipRole: 'OWNER' as const,
  businessMembershipAmbiguous: false,
};

function renderShell() {
  const router = createMemoryRouter(
    [{ element: <AppShell />, children: [{ path: '/', element: <div>content</div> }] }],
    { initialEntries: ['/'] },
  );
  return render(
    <LanguageProvider>
      <RouterProvider router={router} />
    </LanguageProvider>,
  );
}

function mockRole(role: 'OWNER' | 'MANAGER' | 'CASHIER' | null) {
  mockUseAuth.mockReturnValue({
    status: 'authenticated',
    user: { ...baseUser, businessMembershipRole: role },
    login: vi.fn(),
    logout,
    retry: vi.fn(),
  });
}

describe('AppShell', () => {
  beforeEach(() => {
    logout.mockReset();
    mockUseAuth.mockReturnValue({
      status: 'authenticated',
      user: baseUser,
      login: vi.fn(),
      logout,
      retry: vi.fn(),
    });
  });

  it('renders with the session business identity and the authenticated user name', () => {
    renderShell();

    expect(screen.getByText('Aroma Israel')).toBeInTheDocument();
    expect(screen.getByText('Dana Levi')).toBeInTheDocument();
  });

  it('renders the routed core nav items as real links, Team & Permissions included for an OWNER (CAR-117)', () => {
    renderShell();

    expect(screen.getByRole('link', { name: 'הטבות' })).toHaveAttribute('href', '/rewards');
    expect(screen.getByRole('link', { name: 'מימושים' })).toHaveAttribute('href', '/redemption');
    expect(screen.getByRole('link', { name: 'פרטי העסק' })).toHaveAttribute('href', '/business-profile');
    expect(screen.getByRole('link', { name: 'צוות והרשאות' })).toHaveAttribute('href', '/permissions');
  });

  it('renders nav items with no backing route as non-interactive text, not dead links', () => {
    renderShell();

    for (const label of ['סקירה כללית', 'אנליטיקס']) {
      // Not a widget with a disabled state — these were never interactive,
      // so there's no link/button role and nothing for aria-disabled to
      // describe. The "coming soon" badge is what tells the reader why.
      const item = screen.getByText(label).closest('a, button');
      expect(item).toBeNull();
    }
    expect(screen.getAllByText('בקרוב')).toHaveLength(2);
  });

  // CAR-116: capabilities a role cannot use are hidden entirely, not shown
  // disabled — a MANAGER never manages redemption permissions, and a
  // CASHIER never manages permissions or sees redemption history/stats.
  it('hides Team & Permissions from a MANAGER but keeps Analytics', () => {
    mockRole('MANAGER');
    renderShell();

    expect(screen.queryByText('צוות והרשאות')).not.toBeInTheDocument();
    expect(screen.getByText('אנליטיקס')).toBeInTheDocument();
  });

  it('hides Team & Permissions and Analytics from a CASHIER, and still renders Rewards and Redemption as real links', () => {
    mockRole('CASHIER');
    renderShell();

    expect(screen.queryByText('צוות והרשאות')).not.toBeInTheDocument();
    expect(screen.queryByText('אנליטיקס')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'הטבות' })).toHaveAttribute('href', '/rewards');
    expect(screen.getByRole('link', { name: 'מימושים' })).toHaveAttribute('href', '/redemption');
  });

  // CAR-255: ADMIN is a system role, unrelated to business membership — the
  // nav item must show for it regardless of businessMembershipRole, and stay
  // hidden for every ordinary business role.
  it('shows the Business Requests nav link only for an ADMIN', () => {
    mockUseAuth.mockReturnValue({
      status: 'authenticated',
      user: { ...baseUser, role: 'ADMIN' as const, businessMembershipRole: null },
      login: vi.fn(),
      logout,
      retry: vi.fn(),
    });
    renderShell();

    expect(screen.getByRole('link', { name: 'בקשות הצטרפות עסקים' })).toHaveAttribute(
      'href',
      '/admin/business-requests',
    );
  });

  it('hides the Business Requests nav link for a non-admin, even an OWNER', () => {
    renderShell();

    expect(screen.queryByText('בקשות הצטרפות עסקים')).not.toBeInTheDocument();
  });

  // CAR-255 review: a pure ADMIN has no business membership, so every
  // business-only nav item — including the always-on Rewards/Redemption/
  // Business Profile links every ordinary role gets — must not be
  // advertised either; `RequireBusinessRole` refuses all of them regardless.
  it('hides every business-only nav item for an ADMIN, keeping only Business Requests', () => {
    mockUseAuth.mockReturnValue({
      status: 'authenticated',
      user: { ...baseUser, role: 'ADMIN' as const, businessMembershipRole: null },
      login: vi.fn(),
      logout,
      retry: vi.fn(),
    });
    renderShell();

    expect(screen.queryByText('הטבות')).not.toBeInTheDocument();
    expect(screen.queryByText('מימושים')).not.toBeInTheDocument();
    expect(screen.queryByText('פרטי העסק')).not.toBeInTheDocument();
    expect(screen.queryByText('סקירה כללית')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'בקשות הצטרפות עסקים' })).toBeInTheDocument();
  });

  it('signs out through the header control', () => {
    renderShell();

    fireEvent.click(screen.getByRole('button', { name: 'התנתקות' }));

    expect(logout).toHaveBeenCalledOnce();
  });

  it('picks businessNameHe over businessName for the Hebrew default, then flips on language switch', () => {
    mockUseAuth.mockReturnValue({
      status: 'authenticated',
      user: { ...baseUser, businessName: 'Aroma Israel', businessNameHe: 'ארומה ישראל' },
      login: vi.fn(),
      logout,
      retry: vi.fn(),
    });
    renderShell();

    // Default language is Hebrew (see LanguageProvider) — the Hebrew name wins.
    expect(screen.getByText('ארומה ישראל')).toBeInTheDocument();
    expect(screen.queryByText('Aroma Israel')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'English' }));

    // English wins once the UI switches, even though businessNameHe is still set.
    expect(screen.getByText('Aroma Israel')).toBeInTheDocument();
    expect(screen.queryByText('ארומה ישראל')).not.toBeInTheDocument();
  });
});
