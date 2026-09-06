/**
 * @fileoverview Business branch CRUD (CAR-341 continuation)
 * @module lib/api/businessBranches
 *
 * @description
 * Wraps `GET/POST /api/business/branches` and `PATCH
 * /api/business/branches/{id}` on top of `lib/api/client.ts`'s `request()`.
 * Same never-throw-for-an-expected-failure convention as `lib/api/businessProfile.ts`.
 */
import { ApiError, request } from './client';

// The one TypeScript mirror of the server's `BranchOut`
// (server/app/schemas/business_branch.py).
export type Branch = {
  id: string;
  name: string | null;
  address: string | null;
  locationLat: number;
  locationLng: number;
  isActive: boolean;
};

// `address` only ever travels together with the coordinate pair the
// geocode-and-confirm flow produced for it — same reasoning as
// `BusinessProfileUpdatePayload` used to have before location moved here.
type LocationFields = { address: string; locationLat: number; locationLng: number };

export type BranchCreatePayload = { name: string | null } & LocationFields;

export type BranchUpdatePayload = {
  name?: string | null;
  isActive?: boolean;
} & (LocationFields | { address?: undefined; locationLat?: undefined; locationLng?: undefined });

export type BranchResult =
  | { outcome: 'ok'; branch: Branch }
  | { outcome: 'forbidden' }
  | { outcome: 'conflict'; code: string | undefined }
  | { outcome: 'network_error' }
  | { outcome: 'unexpected_error' };

export type BranchListResult =
  | { outcome: 'ok'; branches: Branch[] }
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

export async function listBranches(): Promise<BranchListResult> {
  try {
    const { branches } = await request<{ branches: Branch[] }>('/api/business/branches');
    return { outcome: 'ok', branches };
  } catch (err) {
    return { outcome: errorOutcome(err) };
  }
}

export async function createBranch(payload: BranchCreatePayload): Promise<BranchResult> {
  try {
    const { branch } = await request<{ branch: Branch }>('/api/business/branches', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return { outcome: 'ok', branch };
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) return { outcome: 'conflict', code: err.code };
    return { outcome: errorOutcome(err) };
  }
}

export async function updateBranch(id: string, payload: BranchUpdatePayload): Promise<BranchResult> {
  try {
    const { branch } = await request<{ branch: Branch }>(`/api/business/branches/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    return { outcome: 'ok', branch };
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) return { outcome: 'conflict', code: err.code };
    return { outcome: errorOutcome(err) };
  }
}
