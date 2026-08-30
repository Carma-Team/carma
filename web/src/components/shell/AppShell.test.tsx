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
