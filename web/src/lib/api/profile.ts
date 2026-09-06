/**
 * @fileoverview The signed-in user's own name (CAR-342)
 * @module lib/api/profile
 *
 * @description
 * Wraps `PATCH /api/users/me` — the existing generic profile endpoint every
 * authenticated role already has (server/app/routers/users.py), not a new
 * one minted for this page. Only `name` is sent: email/phone/password have
 * no authenticated change path yet (see the Account Settings design's own
 * "flagged, not built" note), so this module never exposes them.
 */
import { ApiError, request } from './client';

export type UpdateNameResult =
  | { outcome: 'ok'; name: string | null }
  | { outcome: 'network_error' }
  | { outcome: 'unexpected_error' };

function errorOutcome(err: unknown): 'network_error' | 'unexpected_error' {
  return err instanceof ApiError && err.status === 0 ? 'network_error' : 'unexpected_error';
}

export async function updateName(name: string): Promise<UpdateNameResult> {
  try {
    const updated = await request<{ name: string | null }>('/api/users/me', {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    });
    return { outcome: 'ok', name: updated.name };
  } catch (err) {
    return { outcome: errorOutcome(err) };
  }
}
