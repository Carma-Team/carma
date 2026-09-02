/**
 * @fileoverview Voucher-redemption permission management (CAR-117)
 * @module lib/api/businessMembers
 *
 * @description
 * Wraps `GET /api/business/members` and `PATCH/DELETE /api/business/members/{id}`
 * on top of `lib/api/client.ts`'s `request()`. Same never-throw-for-an-
 * expected-failure convention as `lib/api/rewards.ts` — every function
 * resolves to a closed result union the caller switches on. `last_owner`
 * mirrors the server's `LAST_OWNER` code (`services/business_memberships.py`):
 * a role change or a revoke that would leave the business with no OWNER.
 */
import { ApiError, request } from './client';

export type BusinessMembershipRole = 'OWNER' | 'MANAGER' | 'CASHIER';

// The one TypeScript mirror of the server's `BusinessMemberOut`
// (server/app/schemas/business_membership.py).
export type BusinessMember = {
  id: string;
  userId: string;
  name: string | null;
  email: string | null;
  role: BusinessMembershipRole;
  joinedAt: string;
};

export type MembersListResult =
  | { outcome: 'ok'; members: BusinessMember[] }
  | { outcome: 'forbidden' }
  | { outcome: 'network_error' }
  | { outcome: 'unexpected_error' };

export type ChangeMemberRoleResult =
  | { outcome: 'ok'; member: BusinessMember }
  | { outcome: 'forbidden' }
  | { outcome: 'last_owner' }
  | { outcome: 'network_error' }
  | { outcome: 'unexpected_error' };

export type RevokeMemberAccessResult =
  | { outcome: 'ok' }
  | { outcome: 'forbidden' }
  | { outcome: 'last_owner' }
  | { outcome: 'network_error' }
  | { outcome: 'unexpected_error' };

function listErrorOutcome(err: unknown): 'forbidden' | 'network_error' | 'unexpected_error' {
  if (err instanceof ApiError) {
    if (err.status === 0) return 'network_error';
    if (err.status === 403) return 'forbidden';
  }
  return 'unexpected_error';
}

function mutationErrorOutcome(err: unknown): 'forbidden' | 'last_owner' | 'network_error' | 'unexpected_error' {
  if (err instanceof ApiError) {
    if (err.status === 0) return 'network_error';
    if (err.status === 403) return 'forbidden';
    if (err.status === 409 && err.code === 'LAST_OWNER') return 'last_owner';
  }
  return 'unexpected_error';
}

export async function listMembers(): Promise<MembersListResult> {
  try {
    const { members } = await request<{ members: BusinessMember[] }>('/api/business/members');
    return { outcome: 'ok', members };
  } catch (err) {
    return { outcome: listErrorOutcome(err) };
  }
}

export async function changeMemberRole(
  membershipId: string,
  role: BusinessMembershipRole,
): Promise<ChangeMemberRoleResult> {
  try {
    const { member } = await request<{ member: BusinessMember }>(
      `/api/business/members/${encodeURIComponent(membershipId)}`,
      { method: 'PATCH', body: JSON.stringify({ role }) },
    );
    return { outcome: 'ok', member };
  } catch (err) {
    return { outcome: mutationErrorOutcome(err) };
  }
}

export async function revokeMemberAccess(membershipId: string): Promise<RevokeMemberAccessResult> {
  try {
    await request<undefined>(`/api/business/members/${encodeURIComponent(membershipId)}`, { method: 'DELETE' });
    return { outcome: 'ok' };
  } catch (err) {
    return { outcome: mutationErrorOutcome(err) };
  }
}
