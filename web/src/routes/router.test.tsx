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

const businessUser = {
  id: '1',
  name: 'Dana Levi',
  email: null,
  role: 'BUSINESS' as const,
  businessId: 'b1',
  businessCategory: 'food',
  businessName: 'Aroma Israel',
  businessNameHe: null,
};

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

  it('renders the home page inside the shell at / once a restored session bootstraps (default language: Hebrew)', async () => {
    vi.mocked(authApi.refresh).mockResolvedValue({ token: 'tok', user: businessUser });

    renderAt('/');

    // Not `getByText` — the redeem CTA carries the same copy as the heading.
    await waitFor(() => expect(screen.getByRole('heading', { name: 'מימוש הטבה' })).toBeInTheDocument());
    // Shell chrome: business identity from the session, not hardcoded.
    expect(screen.getByText('Aroma Israel')).toBeInTheDocument();
  });

  it('sends / to sign-in when there is no session to restore', async () => {
    vi.mocked(authApi.refresh).mockRejectedValue(new AuthApiError(401, 'Session expired — sign in again'));

    renderAt('/');

    // Not `getByText('התחברות')` — it matches both the page heading and the
    // submit button. The email field is the unambiguous sign-in-page marker.
    await waitFor(() => expect(screen.getByLabelText('אימייל')).toBeInTheDocument());
  });

  it('renders the not-found page inside the shell at an unknown path (default language: Hebrew)', async () => {
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
    vi.mocked(authApi.refresh).mockResolvedValue({ token: 'tok', user: businessUser });

    renderAt('/rewards');

    // Not `getByText` — the sidebar's own disabled nav items carry the same
    // "coming soon" badge copy. The heading is the page-level marker.
    await waitFor(() => expect(screen.getByRole('heading', { name: 'בקרוב' })).toBeInTheDocument());
  });

  it('renders the real redemption page inside the shell at /redemption (CAR-68)', async () => {
    vi.mocked(authApi.refresh).mockResolvedValue({ token: 'tok', user: businessUser });

    renderAt('/redemption');

    await waitFor(() => expect(screen.getByLabelText('קוד שובר')).toBeInTheDocument());
    // Still inside the shell.
    expect(screen.getByText('Aroma Israel')).toBeInTheDocument();
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });
});
