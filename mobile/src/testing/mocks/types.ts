import type { AppUser } from '@/types';

/**
 * One mock account: a fixed login plus how it answers its own domain endpoints.
 * `handleRequest` returns null for anything it doesn't recognize, so
 * registerMockNetwork can fall through cleanly instead of guessing.
 */
export interface MockAccount {
  email: string;
  password: string;
  /** Synthetic bearer token — never a real JWT, just an identity marker. */
  token: string;
  user: AppUser;
  handleRequest(method: string, path: string, body: unknown): { status: number; data: unknown } | null;
}
