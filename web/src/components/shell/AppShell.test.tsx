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

  it('renders the routed core nav items as real links', () => {
    renderShell();

    expect(screen.getByRole('link', { name: 'הטבות' })).toHaveAttribute('href', '/rewards');
    expect(screen.getByRole('link', { name: 'מימושים' })).toHaveAttribute('href', '/redemption');
    expect(screen.getByRole('link', { name: 'פרטי העסק' })).toHaveAttribute('href', '/business-profile');
  });

  it('renders nav items with no backing route as non-interactive text, not dead links', () => {
    renderShell();

    for (const label of ['צוות והרשאות', 'סקירה כללית', 'אנליטיקס']) {
      // Not a widget with a disabled state — these were never interactive,
      // so there's no link/button role and nothing for aria-disabled to
      // describe. The "coming soon" badge is what tells the reader why.
      const item = screen.getByText(label).closest('a, button');
      expect(item).toBeNull();
    }
    expect(screen.getAllByText('בקרוב')).toHaveLength(3);
    expect(screen.queryByRole('link', { name: /צוות והרשאות/ })).not.toBeInTheDocument();
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
