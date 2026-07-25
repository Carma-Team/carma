/**
 * @fileoverview Invite links — share one, or redeem the one you arrived with
 * @module services/api/invites
 *
 * @server
 * - GET  /api/users/me/invite      — the caller's link, stable once minted
 * - POST /api/invites/:code/redeem — befriends whoever shared it
 *
 * Redeem needs a token, so the flow is: deep link stores the code → user signs
 * up or logs in → redeem. Redeeming twice is harmless.
 */
import { request } from './client';
import type { InviteLink, RedeemedInvite } from '@/types';

export const invitesApi = {
  /** The current user's invite link, to drop into a share sheet */
  getMyLink: () => request<InviteLink>('/api/users/me/invite'),

  /** Redeem a code the user arrived with — makes them friends with the sharer */
  redeem: (code: string) =>
    request<RedeemedInvite>(`/api/invites/${encodeURIComponent(code)}/redeem`, { method: 'POST' }),
};
