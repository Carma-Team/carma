/**
 * @fileoverview API לאימות משתמשים — כניסה, רישום, רענון
 * @module services/api/auth
 *
 * @description
 * - `login`    — POST /api/auth/login — כניסה עם email+password
 * - `register` — POST /api/auth/register — רישום משתמש חדש
 * - `me`       — GET /api/auth/me — רענון פרטי המשתמש המחובר
 *
 * @server
 * - USE_REAL_SERVER=false → carma-local-server (חייב לרוץ בטרמינל נפרד)
 * - USE_REAL_SERVER=true  → שרת נווה (FastAPI)
 *
 * משתמשי דמו (מוגדרים ב-db.json של השרת המקומי):
 *   admin@carma.app      / admin123      (מנהל מערכת)
 *   daniel@carma.app     / password123   (נהג)
 *   arcaffe@carma.app    / business123   (עסק — ארקפה)
 *   superpharm@carma.app / business123   (עסק — סופר-פארם)
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
