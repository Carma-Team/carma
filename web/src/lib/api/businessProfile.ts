/**
 * @fileoverview Business's own profile record (CAR-341)
 * @module lib/api/businessProfile
 *
 * @description
 * Wraps `GET/PATCH /api/business/profile` on top of `lib/api/client.ts`'s
 * `request()`. Follows the same never-throw-for-an-expected-failure
 * convention as `lib/api/rewards.ts`: each function resolves to a closed
 * result union the caller switches on.
 */
import { ApiError, request } from './client';

// The one TypeScript mirror of the server's `BusinessProfileOut`
// (server/app/schemas/business_profile.py).
export type BusinessProfile = {
  id: string;
  name: string;
  nameHe: string | null;
  category: string;
  // Mirrors the business's default branch (CAR-341 continuation) — read-only
  // here. Editing a business's location happens only through
  // `lib/api/businessBranches.ts`, never through `BusinessProfileUpdatePayload`.
  address: string | null;
  locationLat: number;
  locationLng: number;
  // Israeli business identifier (ח.פ./עוסק מורשה). Read-only everywhere in
  // this app — there is no change-request workflow yet (see the approved
  // design's own "flagged, not built" note), so it never appears in
  // BusinessProfileUpdatePayload.
  registrationNumber: string | null;
  // The business's real OWNER member (server-resolved from
  // business_memberships, never the calling user) — a MANAGER or CASHIER
  // editing this page must still see the actual owner as the contact
  // person, not themselves. `null` only if the business somehow has no
  // OWNER membership at all.
  ownerName: string | null;
  ownerEmail: string | null;
};

// What the Business Details form actually collects and the server actually
// accepts — a subset of `BusinessProfileOut` (registrationNumber/owner*/
// address/locationLat/locationLng excluded, see their own comments).
// `nameHe: null` is sent explicitly to clear the Hebrew override back to the
// `name` fallback, never omitted — same "omitting a PATCH field means leave
// it alone" convention as RewardPayload's stock/expiresAt.
export type BusinessProfileUpdatePayload = {
  name: string;
  nameHe: string | null;
  category: string;
};

export type BusinessProfileResult =
  | { outcome: 'ok'; profile: BusinessProfile }
  | { outcome: 'forbidden' }
  | { outcome: 'network_error' }
  | { outcome: 'unexpected_error' };

function errorOutcome(err: unknown): 'forbidden' | 'network_error' | 'unexpected_error' {
  if (err instanceof ApiError) {
    if (err.status === 0) return 'network_error';
    if (err.status === 403) return 'forbidden';
  }
  return 'unexpected_error';
}

export async function getBusinessProfile(): Promise<BusinessProfileResult> {
  try {
    const { profile } = await request<{ profile: BusinessProfile }>('/api/business/profile');
    return { outcome: 'ok', profile };
  } catch (err) {
    return { outcome: errorOutcome(err) };
  }
}

export async function updateBusinessProfile(payload: BusinessProfileUpdatePayload): Promise<BusinessProfileResult> {
  try {
    const { profile } = await request<{ profile: BusinessProfile }>('/api/business/profile', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    return { outcome: 'ok', profile };
  } catch (err) {
    return { outcome: errorOutcome(err) };
  }
}
