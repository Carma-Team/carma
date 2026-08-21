import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { authApi, AuthApiError } from './authApi';

// Simulates what a real `fetch` does once its AbortSignal fires: the pending
// promise rejects with a DOMException named AbortError. Nothing else about
// the request matters here — this is only exercising the timeout, not the
// request/response shape (that's covered by client.test.ts and the
// server-side integration tests).
function abortableFetchMock() {
  return vi.fn((_url: string, init?: RequestInit) => {
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('The operation was aborted', 'AbortError'));
      });
    });
  });
}

describe('authApi timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('aborts a hung request and surfaces it as an AuthApiError, not a stuck promise', async () => {
    vi.stubGlobal('fetch', abortableFetchMock());

    const pending = authApi.refresh();
    const assertion = expect(pending).rejects.toMatchObject({ status: 0, message: 'Request timed out' });

    await vi.advanceTimersByTimeAsync(10_000);

    await assertion;
  });

  it('does not fire before the timeout — a request that resolves in time is unaffected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        return new Promise((resolve) => {
          setTimeout(() => resolve(new Response(JSON.stringify({ token: 't', user: null }), { status: 200 })), 1_000);
        });
      }),
    );

    const pending = authApi.refresh();
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(pending).resolves.toMatchObject({ token: 't' });
  });

  it('a timed-out call does not block a fresh attempt afterward', async () => {
    vi.stubGlobal('fetch', abortableFetchMock());

    const first = authApi.refresh();
    const firstAssertion = expect(first).rejects.toBeInstanceOf(AuthApiError);
    await vi.advanceTimersByTimeAsync(10_000);
    await firstAssertion;

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ token: 't2', user: null }), { status: 200 }))),
    );
    await expect(authApi.refresh()).resolves.toMatchObject({ token: 't2' });
  });
});
