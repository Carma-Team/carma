import type { AuthUser } from './types';

export type BusinessMembershipRole = NonNullable<AuthUser['businessMembershipRole']>;

const VALID_ROLES: readonly BusinessMembershipRole[] = ['OWNER', 'MANAGER', 'CASHIER'];

// CAR-50 found mobile comparing the server's uppercase role against a
// lowercase literal, so every check dead-ended into the same denied branch.
// Normalizing once here — rather than trusting the type checker's uppercase
// literal union to reflect what actually arrives over the wire — keeps that
// class of bug from reappearing on the web side.
export function normalizeBusinessRole(role: string | null | undefined): BusinessMembershipRole | null {
  if (!role) return null;
  const upper = role.toUpperCase();
  return (VALID_ROLES as readonly string[]).includes(upper) ? (upper as BusinessMembershipRole) : null;
}

export function hasBusinessRole(role: string | null | undefined, allow: readonly BusinessMembershipRole[]): boolean {
  const normalized = normalizeBusinessRole(role);
  return normalized !== null && allow.includes(normalized);
}
