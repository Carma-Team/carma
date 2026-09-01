import { describe, it, expect } from 'vitest';
import { normalizeBusinessRole, hasBusinessRole } from './businessRole';

describe('normalizeBusinessRole', () => {
  it('accepts the server-shaped uppercase values as-is', () => {
    expect(normalizeBusinessRole('OWNER')).toBe('OWNER');
    expect(normalizeBusinessRole('MANAGER')).toBe('MANAGER');
    expect(normalizeBusinessRole('CASHIER')).toBe('CASHIER');
  });

  it('upper-cases a differently-cased value rather than rejecting it', () => {
    expect(normalizeBusinessRole('cashier')).toBe('CASHIER');
    expect(normalizeBusinessRole('Owner')).toBe('OWNER');
  });

  it('returns null for null, undefined, empty, and any value outside the known set', () => {
    expect(normalizeBusinessRole(null)).toBeNull();
    expect(normalizeBusinessRole(undefined)).toBeNull();
    expect(normalizeBusinessRole('')).toBeNull();
    expect(normalizeBusinessRole('DRIVER')).toBeNull();
  });
});

describe('hasBusinessRole', () => {
  it('matches a role case-insensitively against the allow-list', () => {
    expect(hasBusinessRole('cashier', ['OWNER', 'MANAGER', 'CASHIER'])).toBe(true);
    expect(hasBusinessRole('CASHIER', ['OWNER', 'MANAGER'])).toBe(false);
  });

  it('fails closed for null, ambiguous (also null) or unrecognised roles', () => {
    expect(hasBusinessRole(null, ['OWNER', 'MANAGER', 'CASHIER'])).toBe(false);
    expect(hasBusinessRole('not-a-role', ['OWNER', 'MANAGER', 'CASHIER'])).toBe(false);
  });
});
