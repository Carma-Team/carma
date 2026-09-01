import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { RequireAdmin } from './RequireAdmin';
import { useAuth } from '@/hooks/useAuth';
import { LanguageProvider } from '@/i18n/LanguageContext';
import type { AuthContextValue, AuthUser } from '@/lib/auth/types';

vi.mock('@/hooks/useAuth');

const BASE_USER: AuthUser = {
  id: '1',
  name: null,
  email: null,
  role: 'DRIVER',
  businessId: null,
  businessCategory: null,
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
    register: vi.fn(),
    logout: vi.fn(),
    retry: vi.fn(),
  } satisfies AuthContextValue);
}

function renderGuarded() {
  const router = createMemoryRouter(
    [{ element: <RequireAdmin />, children: [{ path: '/', element: <div>protected content</div> }] }],
    { initialEntries: ['/'] },
  );
  return render(
    <LanguageProvider>
      <RouterProvider router={router} />
    </LanguageProvider>,
  );
}

describe('RequireAdmin', () => {
  it('renders the protected content for an ADMIN', () => {
    mockAuth({ ...BASE_USER, role: 'ADMIN' });
    renderGuarded();
    expect(screen.getByText('protected content')).toBeInTheDocument();
  });

  it('fails closed for a DRIVER', () => {
    mockAuth({ ...BASE_USER, role: 'DRIVER' });
    renderGuarded();
    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('fails closed for a BUSINESS owner (business role is not admin, even as OWNER)', () => {
    mockAuth({ ...BASE_USER, role: 'BUSINESS', businessMembershipRole: 'OWNER' });
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
});
