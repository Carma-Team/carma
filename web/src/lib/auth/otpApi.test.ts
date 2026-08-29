import { describe, it, expect, vi, beforeEach } from 'vitest';
import { startPhoneVerification, requestStatusCheckOtp, verifyOtp } from './otpApi';

function jsonResponse(body: unknown, status: number, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), { status, headers });
}

describe('startPhoneVerification', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('sends OTP via otp/register for a brand-new phone', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ message: 'OTP sent', expiresInSeconds: 300 }, 200));

    const result = await startPhoneVerification('+972501234567', 'Dana');

    expect(result).toEqual({ outcome: 'ok', expiresInSeconds: 300 });
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain('/api/auth/otp/register');
  });

  it('falls back to otp/request when the phone already belongs to a verified account (409)', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ detail: 'A verified user with this phone already exists' }, 409))
      .mockResolvedValueOnce(jsonResponse({ message: 'If the phone is registered an OTP has been sent', expiresInSeconds: 300 }, 200));

    const result = await startPhoneVerification('+972501234567', 'Dana');

    expect(result).toEqual({ outcome: 'ok', expiresInSeconds: 300 });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain('/api/auth/otp/register');
    expect(vi.mocked(fetch).mock.calls[1][0]).toContain('/api/auth/otp/request');
  });

  it('does not fall back on a non-409 failure — that is not "phone already has an account"', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ detail: 'nope' }, 429));

    const result = await startPhoneVerification('+972501234567', 'Dana');

    expect(result).toEqual({ outcome: 'rate_limited', retryAfterSeconds: null });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reports a network failure distinctly', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(startPhoneVerification('+972501234567', 'Dana')).resolves.toEqual({ outcome: 'network_error' });
  });

  it('resolves identically for a brand-new phone and an already-registered one — no enumeration signal in the result', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ message: 'OTP sent', expiresInSeconds: 300 }, 200));
    const freshResult = await startPhoneVerification('+972501111111', 'Dana');

    vi.mocked(fetch)
      .mockReset()
      .mockResolvedValueOnce(jsonResponse({ detail: 'A verified user with this phone already exists' }, 409))
      .mockResolvedValueOnce(jsonResponse({ message: 'If the phone is registered an OTP has been sent', expiresInSeconds: 300 }, 200));
    const existingResult = await startPhoneVerification('+972502222222', 'Dana');

    // Same shape, same fields, no `message`/`detail` passthrough that could
    // carry the server's "already exists" wording to a caller (and from
    // there, to the UI).
    expect(freshResult).toEqual(existingResult);
    expect(freshResult).toEqual({ outcome: 'ok', expiresInSeconds: 300 });
  });
});

describe('requestStatusCheckOtp', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('only ever calls otp/request — never creates an account', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ message: 'sent', expiresInSeconds: 300 }, 200));

    await requestStatusCheckOtp('+972501234567');

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain('/api/auth/otp/request');
  });
});

describe('verifyOtp', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  const USER = {
    id: 'u1',
    name: 'Dana',
    email: null,
    role: 'DRIVER' as const,
    businessId: null,
    businessCategory: null,
    businessName: null,
    businessNameHe: null,
    businessMembershipRole: null,
    businessMembershipAmbiguous: false,
  };

  it('resolves with the access token and user on a correct code', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ token: 'jwt-1', user: USER }, 200));

    const result = await verifyOtp('+972501234567', '1234');

    expect(result).toEqual({ outcome: 'ok', accessToken: 'jwt-1', user: USER });
  });

  it('reports an invalid or expired code as invalid_code, not a generic error', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ detail: 'Invalid or expired code' }, 401));

    await expect(verifyOtp('+972501234567', '0000')).resolves.toEqual({ outcome: 'invalid_code' });
  });
});
