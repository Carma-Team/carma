/**
 * Wraps global.fetch so login with one of the accounts in ./accounts answers
 * from an in-memory fixture instead of the network. Matching is exact-equality
 * on email (login) or bearer token (everything after) — a real account never
 * matches, so its traffic always falls through to the real server unchanged.
 *
 * /api/auth/me and GET /api/trips are handled here, not per-account: every
 * mock session needs them answered the same way to survive AppContext's
 * startup refresh (loadInitialData in context/AppContext.tsx), which otherwise
 * treats the 401 a real server gives a fake token as an invalid session and
 * wipes it.
 */
import { businessMockAccount } from './accounts/business.mock';
import { driverMockAccount } from './accounts/driver.mock';
import type { MockAccount } from './types';

const ACCOUNTS: MockAccount[] = [businessMockAccount, driverMockAccount];

function mockResponse(status: number, data: unknown): Response {
  return new Response(status === 204 ? undefined : JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function tokenOf(init?: RequestInit): string | undefined {
  const headers = init?.headers as Record<string, string> | undefined;
  const auth = headers?.['Authorization'] ?? headers?.['authorization'];
  return auth?.replace(/^Bearer\s+/i, '');
}

function parseBody(init?: RequestInit): unknown {
  if (typeof init?.body !== 'string') return undefined;
  try {
    return JSON.parse(init.body);
  } catch {
    return undefined;
  }
}

export function registerMockNetwork() {
  const originalFetch = global.fetch;

  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace(/^https?:\/\/[^/]+/, '');
    const cleanPath = path.split('?')[0];
    const method = (init?.method ?? 'GET').toUpperCase();

    if (method === 'POST' && cleanPath.endsWith('/api/auth/login')) {
      const body = parseBody(init) as { email?: string; password?: string } | undefined;
      const account = ACCOUNTS.find(a => a.email === body?.email);
      if (account) {
        if (body?.password !== account.password) {
          console.warn(`[mock] wrong password for ${account.email}`);
          return mockResponse(401, { detail: 'Invalid credentials' });
        }
        console.log(`[mock] login as ${account.email}`);
        return mockResponse(200, { token: account.token, user: account.user });
      }
    }

    const token = tokenOf(init);
    const account = token ? ACCOUNTS.find(a => a.token === token) : undefined;
    if (account) {
      if (method === 'GET' && cleanPath.endsWith('/api/auth/me')) {
        return mockResponse(200, account.user);
      }
      if (method === 'GET' && cleanPath.endsWith('/api/trips')) {
        return mockResponse(200, { trips: [] });
      }
      const result = account.handleRequest(method, cleanPath, parseBody(init));
      if (result) {
        console.log(`[mock] ${method} ${cleanPath} → ${account.email}`);
        return mockResponse(result.status, result.data);
      }
    }

    return originalFetch(input, init);
  }) as typeof fetch;
}
