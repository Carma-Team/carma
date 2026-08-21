import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { AuthProvider } from '@/lib/auth/AuthProvider';
import { authApi, AuthApiError } from '@/lib/auth/authApi';
import { setSession } from '@/lib/auth/session';
import { routes } from './router';

vi.mock('@/lib/auth/authApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/authApi')>();
  return { ...actual, authApi: { refresh: vi.fn(), login: vi.fn(), logout: vi.fn() } };
});

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
  });

  it('renders the placeholder page at / once a restored session bootstraps (default language: Hebrew)', async () => {
    vi.mocked(authApi.refresh).mockResolvedValue({
      token: 'tok',
      user: { id: '1', name: null, email: null, role: 'BUSINESS', businessId: null, businessCategory: null },
    });

    renderAt('/');

    await waitFor(() => expect(screen.getByText('תשתית האתר פעילה')).toBeInTheDocument());
  });

  it('sends / to sign-in when there is no session to restore', async () => {
    vi.mocked(authApi.refresh).mockRejectedValue(new AuthApiError(401, 'Session expired — sign in again'));

    renderAt('/');

    // Not `getByText('התחברות')` — it matches both the page heading and the
    // submit button. The email field is the unambiguous sign-in-page marker.
    await waitFor(() => expect(screen.getByLabelText('אימייל')).toBeInTheDocument());
  });

  it('renders the not-found page at an unknown path (default language: Hebrew)', () => {
    vi.mocked(authApi.refresh).mockRejectedValue(new AuthApiError(401, 'Session expired — sign in again'));

    renderAt('/does-not-exist');

    expect(screen.getByText('הדף לא נמצא')).toBeInTheDocument();
  });
});
