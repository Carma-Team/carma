import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { RequireBusinessRole } from './RequireBusinessRole';
import { useAuth } from '@/hooks/useAuth';
import { LanguageProvider } from '@/i18n/LanguageContext';
import type { AuthContextValue, AuthUser } from '@/lib/auth/types';

vi.mock('@/hooks/useAuth');

const BASE_USER: AuthUser = {
  id: '1',
  name: null,
  email: null,
  role: 'BUSINESS',
  businessId: 'b1',
  businessCategory: 'food',
  businessName: null,
  businessNameHe: null,
  businessMembershipRole: null,
  businessMembershipAmbiguous: false,
};

function mockAuth(user: AuthUser | null) {
  vi.mocked(useAuth).mockReturnValue({
    status: 'authenticated',
    user,
    login: vi.fn(),
    loginWithOtp: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    retry: vi.fn(),
  } satisfies AuthContextValue);
}

function renderGuarded() {
  const router = createMemoryRouter(
    [
      {
        element: <RequireBusinessRole allow={['OWNER', 'MANAGER']} />,
        children: [{ path: '/', element: <div>protected content</div> }],
      },
      { path: '/accept-invite', element: <div>accept-invite page</div> },
    ],
    { initialEntries: ['/'] },
  );
  return render(
    <LanguageProvider>
      <RouterProvider router={router} />
    </LanguageProvider>,
  );
}

describe('RequireBusinessRole', () => {
  it('renders the protected content for an OWNER', () => {
    mockAuth({ ...BASE_USER, businessMembershipRole: 'OWNER' });
    renderGuarded();
    expect(screen.getByText('protected content')).toBeInTheDocument();
  });

  it('renders the protected content for a MANAGER', () => {
    mockAuth({ ...BASE_USER, businessMembershipRole: 'MANAGER' });
    renderGuarded();
    expect(screen.getByText('protected content')).toBeInTheDocument();
  });

  it('renders an access-restricted state, not the protected content, for a CASHIER', () => {
    mockAuth({ ...BASE_USER, businessMembershipRole: 'CASHIER' });
    renderGuarded();
    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('fails closed when the membership role is null (no membership, or ambiguous)', () => {
    mockAuth({ ...BASE_USER, businessMembershipRole: null, businessMembershipAmbiguous: true });
    renderGuarded();
    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('fails closed when there is no user at all', () => {
    mockAuth(null);
    renderGuarded();
    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  // CAR-118 review's small completion items: manual-code discoverability for
  // an already-authenticated eligible recipient, not only from the sign-in
  // page — this is the one dead end such an account could otherwise land on.
  it('offers the manual invitation-code link for a signed-in account with no business membership at all', () => {
    mockAuth({ ...BASE_USER, businessMembershipRole: null, businessMembershipAmbiguous: false });
    renderGuarded();
    fireEvent.click(screen.getByRole('link', { name: 'יש לכם קוד הזמנה לעסק?' }));
    expect(screen.getByText('accept-invite page')).toBeInTheDocument();
  });

  it('does not offer the invitation-code link for a genuinely ambiguous account (it already belongs somewhere)', () => {
    mockAuth({ ...BASE_USER, businessMembershipRole: null, businessMembershipAmbiguous: true });
    renderGuarded();
    expect(screen.queryByRole('link', { name: 'יש לכם קוד הזמנה לעסק?' })).not.toBeInTheDocument();
  });

  it('does not offer the invitation-code link for a CASHIER blocked by a narrower role gate', () => {
    mockAuth({ ...BASE_USER, businessMembershipRole: 'CASHIER' });
    renderGuarded();
    expect(screen.queryByRole('link', { name: 'יש לכם קוד הזמנה לעסק?' })).not.toBeInTheDocument();
  });

  // CAR-116: normalization must be a real uppercase check, not a lowercase
  // literal reachable only by coincidence — the bug CAR-50 fixed on mobile.
  it('still matches a role sent in a different case than the allow-list literal', () => {
    mockAuth({ ...BASE_USER, businessMembershipRole: 'owner' as AuthUser['businessMembershipRole'] });
    renderGuarded();
    expect(screen.getByText('protected content')).toBeInTheDocument();
  });
});
