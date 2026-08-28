/**
 * @fileoverview Public phone+OTP verification for the business registration
 * flow (CAR-203) — reachable with no account and no session.
 * @module lib/auth/otpApi
 *
 * @description
 * Deliberately not routed through `lib/api/client.ts`'s `request()`: a wrong
 * OTP code answers 401, and `request()` reads every 401 as "the session
 * expired, try a silent refresh" — which would fire a pointless
 * `/api/auth/refresh` call (no cookie exists yet) on every mistyped code.
 * Same reasoning as `lib/auth/authApi.ts`'s own bypass of it.
 */
import { ApiError } from '@/lib/api/client';
import type { AuthUser } from './types';

const BASE_URL = import.meta.env.VITE_API_URL;

async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Network error');
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const detail: unknown = data.detail;
    const message = typeof detail === 'string' ? detail : 'Request failed';
    const retryAfterHeader = res.headers.get('Retry-After');
    const retryAfterSeconds = retryAfterHeader !== null && retryAfterHeader !== '' ? Number(retryAfterHeader) : NaN;
    throw new ApiError(res.status, message, undefined, Number.isNaN(retryAfterSeconds) ? undefined : retryAfterSeconds);
  }
  return res.json();
}

export type OtpSendResult =
  | { outcome: 'ok'; expiresInSeconds: number }
  | { outcome: 'rate_limited'; retryAfterSeconds: number | null }
  | { outcome: 'network_error' }
  | { outcome: 'unexpected_error' };

async function sendResult(call: () => Promise<{ expiresInSeconds: number }>): Promise<OtpSendResult> {
  try {
    const { expiresInSeconds } = await call();
    return { outcome: 'ok', expiresInSeconds };
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 0) return { outcome: 'network_error' };
      if (err.status === 429) return { outcome: 'rate_limited', retryAfterSeconds: err.retryAfterSeconds ?? null };
      return { outcome: 'unexpected_error' };
    }
    return { outcome: 'unexpected_error' };
  }
}

// `otp/register` 409s only when the phone already belongs to a *verified*
// account (services/auth.py::register_with_otp) — exactly the case CAR-203's
// acceptance criteria call out: attach the request to that existing account
// via a login OTP (services/auth.py::request_login_otp) instead of creating
// a second one.
export function startPhoneVerification(phone: string, name: string): Promise<OtpSendResult> {
  return sendResult(async () => {
    try {
      return await post<{ expiresInSeconds: number }>('/api/auth/otp/register', { phone, name });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        return await post<{ expiresInSeconds: number }>('/api/auth/otp/request', { phone });
      }
      throw err;
    }
  });
}

// Status-lookup only — never creates an account. A phone with no account
// must not be able to conjure one just by asking for a code.
export function requestStatusCheckOtp(phone: string): Promise<OtpSendResult> {
  return sendResult(() => post<{ expiresInSeconds: number }>('/api/auth/otp/request', { phone }));
}

export type OtpVerifyResult =
  | { outcome: 'ok'; accessToken: string; user: AuthUser }
  | { outcome: 'invalid_code' }
  | { outcome: 'rate_limited'; retryAfterSeconds: number | null }
  | { outcome: 'network_error' }
  | { outcome: 'unexpected_error' };

export async function verifyOtp(phone: string, code: string): Promise<OtpVerifyResult> {
  try {
    const { token, user } = await post<{ token: string; user: AuthUser }>('/api/auth/otp/verify', { phone, code });
    return { outcome: 'ok', accessToken: token, user };
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 0) return { outcome: 'network_error' };
      if (err.status === 401) return { outcome: 'invalid_code' };
      if (err.status === 429) return { outcome: 'rate_limited', retryAfterSeconds: err.retryAfterSeconds ?? null };
      return { outcome: 'unexpected_error' };
    }
    return { outcome: 'unexpected_error' };
  }
}
