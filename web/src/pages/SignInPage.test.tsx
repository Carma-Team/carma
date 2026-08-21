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
  const logout = vi.fn();

  beforeEach(() => {
    login.mockReset();
    logout.mockReset();
  });

  it('submits email + password and lands on the home route on success', async () => {
    login.mockResolvedValue(undefined);
    vi.mocked(useAuth).mockReturnValue({ status: 'unauthenticated', user: null, login, logout });

    renderSignIn();
    fireEvent.change(screen.getByLabelText('אימייל'), { target: { value: 'biz@carma.app' } });
    fireEvent.change(screen.getByLabelText('סיסמה'), { target: { value: 'CorrectHorse1' } });
    fireEvent.click(screen.getByRole('button', { name: 'התחברות' }));

    await waitFor(() => expect(login).toHaveBeenCalledWith('biz@carma.app', 'CorrectHorse1'));
    await waitFor(() => expect(screen.getByText('home')).toBeInTheDocument());
  });

  it('shows a translated error and stays on the form when login is rejected', async () => {
    login.mockRejectedValue(new Error('bad creds'));
    vi.mocked(useAuth).mockReturnValue({ status: 'unauthenticated', user: null, login, logout });

    renderSignIn();
    fireEvent.change(screen.getByLabelText('אימייל'), { target: { value: 'biz@carma.app' } });
    fireEvent.change(screen.getByLabelText('סיסמה'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'התחברות' }));

    await waitFor(() => expect(screen.getByText('אימייל או סיסמה שגויים.')).toBeInTheDocument());
    expect(screen.queryByText('home')).not.toBeInTheDocument();
  });

  it('redirects home immediately when a session is already restored', () => {
    vi.mocked(useAuth).mockReturnValue({ status: 'authenticated', user: null, login, logout });

    renderSignIn();

    expect(screen.getByText('home')).toBeInTheDocument();
  });

  it('shows a loading state instead of the form while bootstrap is pending', () => {
    vi.mocked(useAuth).mockReturnValue({ status: 'loading', user: null, login, logout });

    renderSignIn();

    expect(screen.queryByLabelText('אימייל')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
