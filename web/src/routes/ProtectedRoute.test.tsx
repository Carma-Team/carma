import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { ProtectedRoute } from './ProtectedRoute';
import { useAuth } from '@/hooks/useAuth';
import { LanguageProvider } from '@/i18n/LanguageContext';
import type { AuthContextValue } from '@/lib/auth/types';

vi.mock('@/hooks/useAuth');

function mockAuth(status: AuthContextValue['status']) {
  vi.mocked(useAuth).mockReturnValue({ status, user: null, login: vi.fn(), logout: vi.fn() });
}

function renderProtected() {
  const router = createMemoryRouter(
    [
      { path: '/sign-in', element: <div>sign-in page</div> },
      { element: <ProtectedRoute />, children: [{ path: '/', element: <div>secret</div> }] },
    ],
    { initialEntries: ['/'] },
  );
  return render(
    <LanguageProvider>
      <RouterProvider router={router} />
    </LanguageProvider>,
  );
}

describe('ProtectedRoute', () => {
  it('redirects to sign-in when there is no valid session', () => {
    mockAuth('unauthenticated');
    renderProtected();
    expect(screen.getByText('sign-in page')).toBeInTheDocument();
  });

  it('renders the protected content once authenticated', () => {
    mockAuth('authenticated');
    renderProtected();
    expect(screen.getByText('secret')).toBeInTheDocument();
  });

  it('renders neither page while the session bootstrap is still pending', () => {
    mockAuth('loading');
    renderProtected();
    expect(screen.queryByText('secret')).not.toBeInTheDocument();
    expect(screen.queryByText('sign-in page')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
