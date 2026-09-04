import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { SignInPage } from './SignInPage';
import { useAuth } from '@/hooks/useAuth';
import { AuthApiError } from '@/lib/auth/authApi';
import { requestSignInOtp } from '@/lib/auth/otpApi';
import { LanguageProvider } from '@/i18n/LanguageContext';

vi.mock('@/hooks/useAuth');
vi.mock('@/lib/auth/otpApi');

function renderSignIn() {
  const router = createMemoryRouter(
    [
      { path: '/sign-in', element: <SignInPage /> },
      { path: '/', element: <div>home</div> },
      { path: '/accept-invite', element: <div>manual code entry page</div> },
      { path: '/register', element: <div>business registration page</div> },
      { path: '/register/status', element: <div>business request status page</div> },
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
  const loginWithOtp = vi.fn();
  const register = vi.fn();
  const logout = vi.fn();
  const retry = vi.fn();

  beforeEach(() => {
    login.mockReset();
    loginWithOtp.mockReset();
    register.mockReset();
    logout.mockReset();
    retry.mockReset();
    vi.mocked(requestSignInOtp).mockReset();
  });

  it('submits email + password and lands on the home route on success', async () => {
    login.mockResolvedValue(undefined);
    vi.mocked(useAuth).mockReturnValue({
      status: 'unauthenticated',
      user: null,
      login,
      loginWithOtp,
      register,
      logout,
      retry,
    });

    renderSignIn();
    fireEvent.change(screen.getByLabelText('אימייל'), { target: { value: 'biz@carma.app' } });
    fireEvent.change(screen.getByLabelText('סיסמה'), { target: { value: 'CorrectHorse1' } });
    fireEvent.click(screen.getByRole('button', { name: 'התחברות' }));

    await waitFor(() => expect(login).toHaveBeenCalledWith('biz@carma.app', 'CorrectHorse1'));
    await waitFor(() => expect(screen.getByText('home')).toBeInTheDocument());
  });

  it('shows a translated error and stays on the form when login is rejected', async () => {
    login.mockRejectedValue(new Error('bad creds'));
    vi.mocked(useAuth).mockReturnValue({
      status: 'unauthenticated',
      user: null,
      login,
      loginWithOtp,
      register,
      logout,
      retry,
    });

    renderSignIn();
    fireEvent.change(screen.getByLabelText('אימייל'), { target: { value: 'biz@carma.app' } });
    fireEvent.change(screen.getByLabelText('סיסמה'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'התחברות' }));

    await waitFor(() => expect(screen.getByText('אימייל או סיסמה שגויים.')).toBeInTheDocument());
    expect(screen.queryByText('home')).not.toBeInTheDocument();
  });

  it('redirects home immediately when a session is already restored', () => {
    vi.mocked(useAuth).mockReturnValue({
      status: 'authenticated',
      user: null,
      login,
      loginWithOtp,
      register,
      logout,
      retry,
    });

    renderSignIn();

    expect(screen.getByText('home')).toBeInTheDocument();
  });

  it('shows a loading state instead of the form while bootstrap is pending', () => {
    vi.mocked(useAuth).mockReturnValue({ status: 'loading', user: null, login, loginWithOtp, register, logout, retry });

    renderSignIn();

    expect(screen.queryByLabelText('אימייל')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  // CAR-118 review item 5: a recipient given only a code (read aloud, not a
  // clicked link) has no production path to the manual-entry page without
  // this — must be a real, visible, accessible navigation link.
  it('offers a discoverable link to manual invitation-code entry', async () => {
    vi.mocked(useAuth).mockReturnValue({
      status: 'unauthenticated',
      user: null,
      login,
      loginWithOtp,
      register,
      logout,
      retry,
    });

    renderSignIn();
    fireEvent.click(screen.getByRole('link', { name: 'יש לכם קוד הזמנה לעסק?' }));

    await waitFor(() => expect(screen.getByText('manual code entry page')).toBeInTheDocument());
  });

  // CAR-315: sign-in is the only public page most prospective business
  // owners land on, so /register and /register/status need a real,
  // discoverable link here — not just a URL someone happens to know.
  it('offers a discoverable link to business registration', async () => {
    vi.mocked(useAuth).mockReturnValue({
      status: 'unauthenticated',
      user: null,
      login,
      loginWithOtp,
      register,
      logout,
      retry,
    });

    renderSignIn();
    fireEvent.click(screen.getByRole('link', { name: 'יש לכם עסק? רשמו אותו בכרמה' }));

    await waitFor(() => expect(screen.getByText('business registration page')).toBeInTheDocument());
  });

  it('offers a discoverable link to check an existing registration request status', async () => {
    vi.mocked(useAuth).mockReturnValue({
      status: 'unauthenticated',
      user: null,
      login,
      loginWithOtp,
      register,
      logout,
      retry,
    });

    renderSignIn();
    fireEvent.click(screen.getByRole('link', { name: 'בדיקת סטטוס הבקשה' }));

    await waitFor(() => expect(screen.getByText('business request status page')).toBeInTheDocument());
  });

  // ─── CAR-265: the phone + OTP door ──────────────────────────────────────

  describe('phone + OTP sign-in', () => {
    beforeEach(() => {
      vi.mocked(useAuth).mockReturnValue({
        status: 'unauthenticated',
        user: null,
        login,
        loginWithOtp,
        register,
        logout,
        retry,
      });
    });

    it('sends a code, then signs in with it and lands on the home route', async () => {
      vi.mocked(requestSignInOtp).mockResolvedValue({ outcome: 'ok', expiresInSeconds: 300 });
      loginWithOtp.mockResolvedValue(undefined);

      renderSignIn();
      fireEvent.click(screen.getByRole('button', { name: 'התחברות עם טלפון במקום זאת' }));
      fireEvent.change(screen.getByLabelText('טלפון נייד'), { target: { value: '+972501234567' } });
      fireEvent.click(screen.getByRole('button', { name: 'שליחת קוד' }));

      await waitFor(() => expect(requestSignInOtp).toHaveBeenCalledWith('+972501234567'));
      fireEvent.change(await screen.findByLabelText('קוד אימות'), { target: { value: '112233' } });
      fireEvent.click(screen.getByRole('button', { name: 'התחברות' }));

      await waitFor(() => expect(loginWithOtp).toHaveBeenCalledWith('+972501234567', '112233'));
      await waitFor(() => expect(screen.getByText('home')).toBeInTheDocument());
    });

    it('shows a translated error and stays on the code step when the code is wrong', async () => {
      vi.mocked(requestSignInOtp).mockResolvedValue({ outcome: 'ok', expiresInSeconds: 300 });
      loginWithOtp.mockRejectedValue(new AuthApiError(401, 'Invalid or expired code'));

      renderSignIn();
      fireEvent.click(screen.getByRole('button', { name: 'התחברות עם טלפון במקום זאת' }));
      fireEvent.change(screen.getByLabelText('טלפון נייד'), { target: { value: '+972501234567' } });
      fireEvent.click(screen.getByRole('button', { name: 'שליחת קוד' }));
      fireEvent.change(await screen.findByLabelText('קוד אימות'), { target: { value: '000000' } });
      fireEvent.click(screen.getByRole('button', { name: 'התחברות' }));

      await waitFor(() => expect(screen.getByText('קוד שגוי או שפג תוקפו — בקשו קוד חדש.')).toBeInTheDocument());
      expect(screen.queryByText('home')).not.toBeInTheDocument();
      // Still on the code step, not bounced back to entering the phone again.
      expect(screen.getByLabelText('קוד אימות')).toBeInTheDocument();
    });

    it('switching back to email + password clears the phone form', async () => {
      vi.mocked(requestSignInOtp).mockResolvedValue({ outcome: 'ok', expiresInSeconds: 300 });

      renderSignIn();
      fireEvent.click(screen.getByRole('button', { name: 'התחברות עם טלפון במקום זאת' }));
      fireEvent.change(screen.getByLabelText('טלפון נייד'), { target: { value: '+972501234567' } });
      fireEvent.click(screen.getByRole('button', { name: 'שליחת קוד' }));
      await screen.findByLabelText('קוד אימות');

      fireEvent.click(screen.getByRole('button', { name: 'התחברות עם אימייל במקום זאת' }));

      expect(screen.getByLabelText('אימייל')).toBeInTheDocument();
      expect(screen.queryByLabelText('קוד אימות')).not.toBeInTheDocument();
    });
  });
});
