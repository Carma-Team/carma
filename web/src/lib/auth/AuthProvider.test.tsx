import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { useContext } from 'react';
import { AuthProvider } from './AuthProvider';
import { AuthContext } from './context';
import { authApi } from './authApi';
import { getSession, setSession } from './session';
import type { AuthUser } from './types';

vi.mock('./authApi', () => ({
  authApi: { refresh: vi.fn(), login: vi.fn(), logout: vi.fn() },
}));

const USER: AuthUser = {
  id: '1',
  name: 'Biz Owner',
  email: 'biz@carma.app',
  role: 'BUSINESS',
  businessId: 'b1',
  businessCategory: 'FOOD',
};

function Probe() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('no context');
  return (
    <div>
      <div data-testid="status">{ctx.status}</div>
      <div data-testid="user">{ctx.user?.email ?? 'none'}</div>
      {/* SignInPage is the real consumer and already awaits + catches a
          rejected login() (see its handleSubmit) — swallowed here too so a
          future test with a rejecting `authApi.login` surfaces as this
          component's own state rather than an unhandled rejection. */}
      <button onClick={() => ctx.login('biz@carma.app', 'CorrectHorse1').catch(() => {})}>login</button>
      <button onClick={() => ctx.logout()}>logout</button>
    </div>
  );
}

function renderProvider() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

describe('AuthProvider', () => {
  beforeEach(() => {
    setSession(null);
    vi.mocked(authApi.refresh).mockReset();
    vi.mocked(authApi.login).mockReset();
    vi.mocked(authApi.logout).mockReset();
  });

  it('starts loading, then settles unauthenticated when there is no session to restore', async () => {
    vi.mocked(authApi.refresh).mockRejectedValue(new Error('no cookie'));

    renderProvider();

    expect(screen.getByTestId('status')).toHaveTextContent('loading');
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'));
  });

  it('restores the session on mount when the refresh cookie is still good — reload survival', async () => {
    vi.mocked(authApi.refresh).mockResolvedValue({ token: 'tok-1', user: USER });

    renderProvider();

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    expect(screen.getByTestId('user')).toHaveTextContent('biz@carma.app');
  });

  it('login moves status to authenticated using the token login itself returned', async () => {
    vi.mocked(authApi.refresh).mockRejectedValue(new Error('no cookie')); // the bootstrap-on-mount call
    // Already short-lived — `X-Requested-With` (sent on every `authApi` call,
    // login included) is what tells `/api/auth/login` this is the web app;
    // see `services/auth.py::login_with_password`. No follow-up refresh
    // needed just to downgrade the token, so `authApi.refresh` is never
    // called again after the bootstrap attempt above.
    vi.mocked(authApi.login).mockResolvedValue({ token: 'tok-web-short-lived', user: USER });

    renderProvider();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'));

    fireEvent.click(screen.getByText('login'));

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    expect(authApi.login).toHaveBeenCalledWith('biz@carma.app', 'CorrectHorse1');
    expect(authApi.refresh).toHaveBeenCalledTimes(1); // just the bootstrap attempt, nothing after login
    expect(getSession()?.accessToken).toBe('tok-web-short-lived');
  });

  it('logout ends the session even if the server call fails', async () => {
    vi.mocked(authApi.refresh).mockResolvedValue({ token: 'tok-1', user: USER });
    vi.mocked(authApi.logout).mockRejectedValue(new Error('network down'));

    renderProvider();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));

    fireEvent.click(screen.getByText('logout'));

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'));
  });
});
