/**
 * @fileoverview Business-permission invitations (CAR-118)
 * @module lib/api/businessInvitations
 *
 * @description
 * Wraps `POST/GET /api/business/invitations`, `DELETE /api/business/invitations/{id}`
 * and the recipient-side `GET/POST /api/invitations/{token}[/accept]` on top of
 * `lib/api/client.ts`'s `request()`. Same never-throw-for-an-expected-failure
 * convention as `lib/api/businessMembers.ts` — every function resolves to a
 * closed result union the caller switches on.
 *
 * `invalid` collapses every one of CAR-76's indistinguishable 404 states
 * (unknown, used, revoked, expired token) into a single outcome — the server
 * already answers all four identically, and a client-side distinction here
 * would quietly reopen exactly what that design closed.
 */
import { ApiError, request } from './client';

// Mirrors the server's `InvitationRole` (server/app/schemas/business_invitation.py) —
// deliberately lowercase and OWNER-less, unlike `BusinessMembershipRole`.
export type InvitationRole = 'manager' | 'cashier';

// The one TypeScript mirror of `BusinessInvitationOut` — returned once, at
// creation, and never re-derivable afterward.
export type CreatedInvitation = {
  id: string;
  role: InvitationRole;
  token: string;
  url: string;
  expiresAt: string;
};

// Mirrors `BusinessInvitationListItem` — never the token or the url.
export type PendingInvitation = {
  id: string;
  role: InvitationRole;
  createdAt: string;
  expiresAt: string;
};

// Mirrors `BusinessInvitationPreviewOut`.
export type InvitationPreview = {
  businessId: string;
  businessName: string;
  role: InvitationRole;
  expiresAt: string;
};

// Mirrors `BusinessInvitationAcceptOut`.
export type AcceptedMembership = {
  businessId: string;
  role: InvitationRole;
};

export type CreateInvitationResult =
  | { outcome: 'ok'; invitation: CreatedInvitation }
  | { outcome: 'forbidden' }
  | { outcome: 'network_error' }
  | { outcome: 'unexpected_error' };

export type ListInvitationsResult =
  | { outcome: 'ok'; invitations: PendingInvitation[] }
  | { outcome: 'forbidden' }
  | { outcome: 'network_error' }
  | { outcome: 'unexpected_error' };

export type RevokeInvitationResult =
  | { outcome: 'ok' }
  | { outcome: 'forbidden' }
  | { outcome: 'not_found' }
  // The invitation was redeemed a moment before this revoke reached the
  // server (`services/business_invitations.py::revoke_invitation`'s
  // `409 ALREADY_REDEEMED`) — a stale row in this OWNER's list, not an
  // unexpected failure: there is nothing left here to revoke.
  | { outcome: 'already_redeemed' }
  | { outcome: 'network_error' }
  | { outcome: 'unexpected_error' };

export type PreviewInvitationResult =
  | { outcome: 'ok'; invitation: InvitationPreview }
  // Same single state for unknown/used/revoked/expired — see module docstring.
  | { outcome: 'invalid' }
  | { outcome: 'network_error' }
  | { outcome: 'unexpected_error' };

export type AcceptInvitationResult =
  | { outcome: 'ok'; membership: AcceptedMembership }
  | { outcome: 'invalid' }
  // Distinct from `invalid` on purpose — CAR-76's `ALREADY_MEMBER` is a real,
  // named conflict the server surfaces deliberately, not one of the
  // indistinguishable invalid states.
  | { outcome: 'already_member' }
  | { outcome: 'network_error' }
  | { outcome: 'unexpected_error' };

function listErrorOutcome(err: unknown): 'forbidden' | 'network_error' | 'unexpected_error' {
  if (err instanceof ApiError) {
    if (err.status === 0) return 'network_error';
    if (err.status === 403) return 'forbidden';
  }
  return 'unexpected_error';
}

export async function createInvitation(role: InvitationRole): Promise<CreateInvitationResult> {
  try {
    const { invitation } = await request<{ invitation: CreatedInvitation }>('/api/business/invitations', {
      method: 'POST',
      body: JSON.stringify({ role }),
    });
    return { outcome: 'ok', invitation };
  } catch (err) {
    return { outcome: listErrorOutcome(err) };
  }
}

export async function listInvitations(): Promise<ListInvitationsResult> {
  try {
    const { invitations } = await request<{ invitations: PendingInvitation[] }>('/api/business/invitations');
    return { outcome: 'ok', invitations };
  } catch (err) {
    return { outcome: listErrorOutcome(err) };
  }
}

export async function revokeInvitation(invitationId: string): Promise<RevokeInvitationResult> {
  try {
    await request<undefined>(`/api/business/invitations/${encodeURIComponent(invitationId)}`, { method: 'DELETE' });
    return { outcome: 'ok' };
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 0) return { outcome: 'network_error' };
      if (err.status === 403) return { outcome: 'forbidden' };
      if (err.status === 404) return { outcome: 'not_found' };
      if (err.status === 409 && err.code === 'ALREADY_REDEEMED') return { outcome: 'already_redeemed' };
    }
    return { outcome: 'unexpected_error' };
  }
}

export async function previewInvitation(token: string): Promise<PreviewInvitationResult> {
  try {
    const { invitation } = await request<{ invitation: InvitationPreview }>(
      `/api/invitations/${encodeURIComponent(token)}`,
    );
    return { outcome: 'ok', invitation };
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 0) return { outcome: 'network_error' };
      if (err.status === 404) return { outcome: 'invalid' };
    }
    return { outcome: 'unexpected_error' };
  }
}

export async function acceptInvitation(token: string): Promise<AcceptInvitationResult> {
  try {
    const { membership } = await request<{ membership: AcceptedMembership }>(
      `/api/invitations/${encodeURIComponent(token)}/accept`,
      { method: 'POST' },
    );
    return { outcome: 'ok', membership };
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 0) return { outcome: 'network_error' };
      if (err.status === 404) return { outcome: 'invalid' };
      if (err.status === 409 && err.code === 'ALREADY_MEMBER') return { outcome: 'already_member' };
    }
    return { outcome: 'unexpected_error' };
  }
}
