import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { CreateAccountPage } from './CreateAccountPage';
import { useAuth } from '@/hooks/useAuth';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { AuthApiError } from '@/lib/auth/authApi';

vi.mock('@/hooks/useAuth');

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      { path: '/create-account', element: <CreateAccountPage /> },
      { path: '/business-invite', element: <div>invitation page</div> },
      { path: '/', element: <div>home</div> },
    ],
    { initialEntries: [{ pathname: path, state: { from: '/business-invite#TXQ947ZKPS' } }] },
  );
  return render(
    <LanguageProvider>
      <RouterProvider router={router} />
    </LanguageProvider>,
  );
}

describe('CreateAccountPage', () => {
  const register = vi.fn();

  beforeEach(() => {
    register.mockReset();
    vi.mocked(useAuth).mockReturnValue({
      status: 'unauthenticated',
      user: null,
      login: vi.fn(),
      loginWithOtp: vi.fn(),
      register,
      logout: vi.fn(),
      retry: vi.fn(),
    });
  });

  it('creates an account and returns to the page that sent the recipient here (e.g. an invitation)', async () => {
    register.mockResolvedValue(undefined);

    renderAt('/create-account');
    fireEvent.change(screen.getByLabelText('שם מלא'), { target: { value: 'Dana Levi' } });
    fireEvent.change(screen.getByLabelText('אימייל'), { target: { value: 'dana@example.com' } });
    fireEvent.change(screen.getByLabelText('סיסמה'), { target: { value: 'CorrectHorse1' } });
    fireEvent.click(screen.getByRole('button', { name: 'יצירת חשבון' }));

    await waitFor(() => expect(register).toHaveBeenCalledWith('Dana Levi', 'dana@example.com', 'CorrectHorse1'));
    await waitFor(() => expect(screen.getByText('invitation page')).toBeInTheDocument());
  });

  it('shows a specific message when the email is already registered, and stays on the form', async () => {
    register.mockRejectedValue(new AuthApiError(409, 'Email already registered'));

    renderAt('/create-account');
    fireEvent.change(screen.getByLabelText('שם מלא'), { target: { value: 'Dana Levi' } });
    fireEvent.change(screen.getByLabelText('אימייל'), { target: { value: 'dana@example.com' } });
    fireEvent.change(screen.getByLabelText('סיסמה'), { target: { value: 'CorrectHorse1' } });
    fireEvent.click(screen.getByRole('button', { name: 'יצירת חשבון' }));

    await waitFor(() => expect(screen.getByText('כבר קיים חשבון עם האימייל הזה — התחברו במקום זאת.')).toBeInTheDocument());
    expect(screen.queryByText('invitation page')).not.toBeInTheDocument();
  });

  it('redirects immediately when a session is already restored', () => {
    vi.mocked(useAuth).mockReturnValue({
      status: 'authenticated',
      user: null,
      login: vi.fn(),
      loginWithOtp: vi.fn(),
      register,
      logout: vi.fn(),
      retry: vi.fn(),
    });

    renderAt('/create-account');

    expect(screen.getByText('invitation page')).toBeInTheDocument();
  });
});
