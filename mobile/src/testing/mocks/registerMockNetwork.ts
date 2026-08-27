/**
 * Wraps global.fetch so login with one of the accounts in ./accounts answers
 * from an in-memory fixture instead of the network. Matching is exact-equality
 * on email (login) or bearer token (everything after) — a real account never
 * matches, so its traffic always falls through to the real server unchanged.
 *
 * The endpoints at the bottom are handled here, not per-account: every mock
 * session needs them answered the same way to survive AppContext's startup
 * refresh (loadInitialData in context/AppContext.tsx), which otherwise treats
 * the 401 a real server gives a fake token as an invalid session and wipes it.
 * They are defaults, though — an account is asked first and may answer any of
 * them itself.
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

/**
 * Enough of DrivingStats to keep the dashboard quiet, carrying over the totals the
 * account's own user already states. An account with trips of its own answers this
 * itself and gets numbers that agree with them.
 */
function blankStats(user: MockAccount['user']) {
  return {
    totalTrips: 0,
    totalDistance: user.totalDistance ?? 0,
    totalPoints: user.totalPoints ?? 0,
    averageScore: 0,
    safeTripsCount: 0,
    totalDurationSeconds: 0,
    currentStreak: 0,
    bestStreak: 0,
    recentScores: [],
    eventCounts: { hardBrakes: 0, aggressiveAccels: 0, sharpTurns: 0, touchEpochs: 0 },
  };
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
  // `globalThis`, not `global`: the latter is typed by @types/node, which this app
  // does not depend on, so it reads as an untyped name in the editor.
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
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
      // Asked before the defaults below, so an account that has its own trips can
      // say so instead of being overruled by the empty list every session gets.
      const result = account.handleRequest(method, cleanPath, parseBody(init));
      if (result) {
        console.log(`[mock] ${method} ${cleanPath} → ${account.email}`);
        return mockResponse(result.status, result.data);
      }
      if (method === 'GET' && cleanPath.endsWith('/api/auth/me')) {
        return mockResponse(200, account.user);
      }
      if (method === 'GET' && cleanPath.endsWith('/api/trips')) {
        return mockResponse(200, { trips: [] });
      }
      // Read on every dashboard focus for the header's badge counts. Left to fall
      // through, they reach the real server with a synthetic token, 401, and pin
      // both badges at zero for the whole mock session.
      if (method === 'GET' && cleanPath.endsWith('/api/friend-requests')) {
        return mockResponse(200, { requests: [] });
      }
      if (method === 'GET' && cleanPath.endsWith('/api/notifications')) {
        return mockResponse(200, []);
      }
      // Requested on every dashboard mount. Unanswered, the synthetic token reaches
      // the real server as a malformed JWT and comes back as a console error over
      // the whole mock session ("invalid token: Not enough segments").
      if (method === 'GET' && cleanPath.endsWith('/api/user/stats')) {
        return mockResponse(200, { stats: blankStats(account.user) });
      }
    }

    return originalFetch(input, init);
  }) as typeof fetch;
}
