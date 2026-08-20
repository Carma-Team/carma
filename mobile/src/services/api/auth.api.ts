/**
 * @fileoverview User authentication API — login, register, refresh
 * @module services/api/auth
 *
 * @description
 * - `login`    — POST /api/auth/login — sign in with email+password
 * - `register` — POST /api/auth/register — create a new user account
 * - `me`       — GET /api/auth/me — refresh the current user's details
 *
 * @server POST/GET requests go straight to the real server (FastAPI) — no client-side interception.
 */
import { request } from './client';
import type { AppUser } from '@/types';

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
};
