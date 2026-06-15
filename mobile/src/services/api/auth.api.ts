/**
 * @fileoverview User authentication API — login, register, refresh
 * @module services/api/auth
 *
 * @description
 * - `login`    — POST /api/auth/login — sign in with email+password
 * - `register` — POST /api/auth/register — create a new user account
 * - `me`       — GET /api/auth/me — refresh the current user's details
 *
 * @server
 * - USE_REAL_SERVER=false → carma-local-server (must be running in a separate terminal)
 * - USE_REAL_SERVER=true  → real server (FastAPI)
 *
 * Demo users (defined in the local server's db.json):
 *   admin@carma.app      / admin123      (system admin)
 *   daniel@carma.app     / password123   (driver)
 *   arcaffe@carma.app    / business123   (business — Arcaffe)
 *   superpharm@carma.app / business123   (business — Super-Pharm)
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
