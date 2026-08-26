/**
 * @fileoverview Business-side voucher lookup and redemption
 * @module lib/api/vouchers
 *
 * @description
 * Wraps `GET /api/business/vouchers/{code}` (peek) and
 * `POST /api/business/vouchers/{code}/redeem` (consume) on top of
 * `lib/api/client.ts`'s `request()`, so both get the same authenticated
 * business session and 401-refresh-retry for free. Neither function throws
 * for an expected failure — each resolves to a `VoucherResult` the caller
 * switches on, because CAR-68/CAR-69 (the screen and its failure states) must
 * never need to catch an exception to find out a voucher was already used.
 */
import { ApiError, request } from './client';

export type Reward = {
  id: string;
  businessId: string;
  business: string;
  businessHe: string | null;
  titleHe: string;
  titleEn: string | null;
  descriptionHe: string;
  descriptionEn: string | null;
  category: string;
  costPoints: number;
  imageIcon: string;
  isActive: boolean;
  archivedAt: string | null;
  stock: number | null;
  available: number | null;
  expiresAt: string | null;
};

// CAR-78: no driver identifier of any kind — the server's BusinessVoucherOut
// deliberately drops `userId` so the business side never sees who the driver is.
export type Voucher = {
  id: string;
  rewardId: string;
  code: string;
  qrData: string;
  status: string;
  isUsed: boolean;
  expiresAt: string;
  redeemedAt: string | null;
  createdAt: string;
  pointsCost: number;
  reward: Reward;
};

// Must match `services/business.py`'s VOUCHER_* constants — the only contract
// between the two sides of CAR-67's 409 discriminator.
const VOUCHER_ALREADY_USED = 'VOUCHER_ALREADY_USED';
const VOUCHER_EXPIRED = 'VOUCHER_EXPIRED';

export type VoucherResult =
  | { outcome: 'ok'; voucher: Voucher }
  // Covers both an unknown code and one issued against another business — the
  // server answers both as 404 on purpose (see `_owned_voucher`), so the
  // client must not imply a distinction the server deliberately hides.
  | { outcome: 'not_valid_here' }
  | { outcome: 'already_used' }
  | { outcome: 'expired' }
  | { outcome: 'rate_limited'; retryAfterSeconds: number | null }
  // No response at all — offline, DNS, CORS, a dropped connection.
  | { outcome: 'network_error' }
  // Any other status, or a 409 whose `code` is neither of the two above. Kept
  // distinct from `network_error`: this did reach the server.
  | { outcome: 'unexpected_error' };

// Mirrors `server/app/core/security.py::normalise_voucher_code` — strips the
// separators a cashier's keyboard or a phone's smart punctuation can
// introduce, then upper-cases. The server re-normalizes on every lookup
// regardless, so this only keeps the code actually placed in the URL
// predictable rather than being the source of truth.
// Written as escapes, not the characters themselves — six kinds of dash are
// indistinguishable by eye in a source file. U+2010-2015 (iOS smart
// punctuation turns a typed hyphen into U+2013), the minus sign U+2212, and
// the Hebrew maqaf U+05BE, same set as the server's `_SEPARATORS`.
const SEPARATORS = /[\s_\-\u2010-\u2015\u2212\u05be]+/g;

function isAscii(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) > 127) return false;
  }
  return true;
}

export function normalizeVoucherCode(code: string): string {
  const stripped = code.replace(SEPARATORS, '');
  // Reject before upper-casing, same order and reason as the server: folding
  // case is not length-preserving outside ASCII (`ß` becomes `SS`), so a
  // non-ASCII leftover must be refused rather than silently expanded.
  if (!isAscii(stripped)) return '';
  return stripped.toUpperCase();
}

async function toResult(call: () => Promise<{ voucher: Voucher }>): Promise<VoucherResult> {
  try {
    const { voucher } = await call();
    return { outcome: 'ok', voucher };
  } catch (err) {
    if (err instanceof ApiError) {
      // status 0 is `client.ts`'s sentinel for "no real response" — see `safeFetch`.
      if (err.status === 0) return { outcome: 'network_error' };
      if (err.status === 404) return { outcome: 'not_valid_here' };
      if (err.status === 409) {
        if (err.code === VOUCHER_ALREADY_USED) return { outcome: 'already_used' };
        if (err.code === VOUCHER_EXPIRED) return { outcome: 'expired' };
        return { outcome: 'unexpected_error' };
      }
      if (err.status === 429) return { outcome: 'rate_limited', retryAfterSeconds: err.retryAfterSeconds ?? null };
      return { outcome: 'unexpected_error' };
    }
    // A bug or a response that failed to parse, not a network failure — the
    // request may well have reached the server. Conflating this with
    // `network_error` would hide a real defect behind "you're offline".
    return { outcome: 'unexpected_error' };
  }
}

export function peekVoucher(code: string): Promise<VoucherResult> {
  const normalized = normalizeVoucherCode(code);
  return toResult(() => request<{ voucher: Voucher }>(`/api/business/vouchers/${encodeURIComponent(normalized)}`));
}

export function consumeVoucher(code: string): Promise<VoucherResult> {
  const normalized = normalizeVoucherCode(code);
  return toResult(() =>
    request<{ voucher: Voucher }>(`/api/business/vouchers/${encodeURIComponent(normalized)}/redeem`, { method: 'POST' }),
  );
}
