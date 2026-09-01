import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { SignInPage } from './SignInPage';
import { useAuth } from '@/hooks/useAuth';
import { LanguageProvider } from '@/i18n/LanguageContext';

vi.mock('@/hooks/useAuth');

function renderSignIn() {
  const router = createMemoryRouter(
    [
      { path: '/sign-in', element: <SignInPage /> },
      { path: '/', element: <div>home</div> },
      { path: '/accept-invite', element: <div>manual code entry page</div> },
    ],
    { initialEntries: ['/sign-in'] },
  );
  return render(
    <LanguageProvider>
      <RouterProvider router={router} />
    </LanguageProvider>,
  );
}

describe('SignInPage', () => {
  const login = vi.fn();
  const register = vi.fn();
  const logout = vi.fn();
  const retry = vi.fn();

  beforeEach(() => {
    login.mockReset();
    register.mockReset();
    logout.mockReset();
    retry.mockReset();
  });

  it('submits email + password and lands on the home route on success', async () => {
    login.mockResolvedValue(undefined);
    vi.mocked(useAuth).mockReturnValue({ status: 'unauthenticated', user: null, login, register, logout, retry });

    renderSignIn();
    fireEvent.change(screen.getByLabelText('אימייל'), { target: { value: 'biz@carma.app' } });
    fireEvent.change(screen.getByLabelText('סיסמה'), { target: { value: 'CorrectHorse1' } });
    fireEvent.click(screen.getByRole('button', { name: 'התחברות' }));

    await waitFor(() => expect(login).toHaveBeenCalledWith('biz@carma.app', 'CorrectHorse1'));
    await waitFor(() => expect(screen.getByText('home')).toBeInTheDocument());
  });

  it('shows a translated error and stays on the form when login is rejected', async () => {
    login.mockRejectedValue(new Error('bad creds'));
    vi.mocked(useAuth).mockReturnValue({ status: 'unauthenticated', user: null, login, register, logout, retry });

    renderSignIn();
    fireEvent.change(screen.getByLabelText('אימייל'), { target: { value: 'biz@carma.app' } });
    fireEvent.change(screen.getByLabelText('סיסמה'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'התחברות' }));

    await waitFor(() => expect(screen.getByText('אימייל או סיסמה שגויים.')).toBeInTheDocument());
    expect(screen.queryByText('home')).not.toBeInTheDocument();
  });

  it('redirects home immediately when a session is already restored', () => {
    vi.mocked(useAuth).mockReturnValue({ status: 'authenticated', user: null, login, register, logout, retry });

    renderSignIn();

    expect(screen.getByText('home')).toBeInTheDocument();
  });

  it('shows a loading state instead of the form while bootstrap is pending', () => {
    vi.mocked(useAuth).mockReturnValue({ status: 'loading', user: null, login, register, logout, retry });

    renderSignIn();

    expect(screen.queryByLabelText('אימייל')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  // CAR-118 review item 5: a recipient given only a code (read aloud, not a
  // clicked link) has no production path to the manual-entry page without
  // this — must be a real, visible, accessible navigation link.
  it('offers a discoverable link to manual invitation-code entry', async () => {
    vi.mocked(useAuth).mockReturnValue({ status: 'unauthenticated', user: null, login, register, logout, retry });

    renderSignIn();
    fireEvent.click(screen.getByRole('link', { name: 'יש לכם קוד הזמנה לעסק?' }));

    await waitFor(() => expect(screen.getByText('manual code entry page')).toBeInTheDocument());
  });
});
