/**
 * @fileoverview User authentication API — login, register, refresh
 * @module services/api/auth
 *
 * @description
 * - `login`    — POST /api/auth/login — sign in with email+password
 * - `register` — POST /api/auth/register — create a new user account
 * - `me`       — GET /api/auth/me — refresh the current user's details
 * - `requestPasswordReset` — POST /api/auth/password/reset/request — send a reset code by SMS
 * - `confirmPasswordReset` — POST /api/auth/password/reset/confirm — spend the code on a new password
 *
 * @server POST/GET requests go straight to the real server (FastAPI) — no client-side interception.
 */
import { request } from './client';
import type { AppUser, MessageOut, OtpSent } from '@/types';

export interface AuthResponse {
  token: string;
  user: AppUser;
}

export interface RegisterPayload {
  name: string;
  email: string;
  password: string;
  phone?: string;
  city?: string;
  age?: number;
  licenseYear?: number;
}

export const authApi = {
  login: (email: string, password: string) =>
    request<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
      public: true,
    }),

  register: (payload: RegisterPayload) =>
    request<AuthResponse>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
      public: true,
    }),

  me: () => request<AppUser>('/api/auth/me'),

  /**
   * Ask for a password-reset code.
   *
   * `phone` must already be E.164 (`toE164`) — the route rejects any other shape
   * with a 422. The answer is the same whether or not the number is registered,
   * so nothing here can be used to tell the two apart.
   */
  requestPasswordReset: (phone: string) =>
    request<OtpSent>('/api/auth/password/reset/request', {
      method: 'POST',
      body: JSON.stringify({ phone }),
      public: true,
    }),

  /**
   * Spend a reset code on a new password. No token comes back — a reset is not a
   * sign-in, so the driver signs in with the new password afterwards.
   */
  confirmPasswordReset: (phone: string, code: string, newPassword: string) =>
    request<MessageOut>('/api/auth/password/reset/confirm', {
      method: 'POST',
      body: JSON.stringify({ phone, code, newPassword }),
      public: true,
    }),
};
