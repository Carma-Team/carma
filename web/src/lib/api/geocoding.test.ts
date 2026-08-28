import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { geocodeAddress } from './geocoding';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

// Mirrors `lib/auth/authApi.test.ts`'s helper — simulates what a real
// `fetch` does once its AbortSignal fires: the pending promise rejects with
// a DOMException named AbortError.
function abortableFetchMock() {
  return vi.fn((_url: string, init?: RequestInit) => {
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('The operation was aborted', 'AbortError'));
      });
    });
  });
}

describe('geocodeAddress', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('resolves the first match from the geocoding provider', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse([{ lat: '32.0648', lon: '34.7748' }]));

    const result = await geocodeAddress('Rothschild 1, Tel Aviv');

    expect(result).toEqual({ outcome: 'found', lat: 32.0648, lng: 34.7748 });
    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(url).toContain('nominatim.openstreetmap.org/search');
    expect(url).toContain('q=Rothschild');
  });

  it('sends exactly one request per call — never per keystroke, staying under the 1 req/sec policy', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse([{ lat: '32.0648', lon: '34.7748' }]));

    await geocodeAddress('Rothschild 1, Tel Aviv');

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reports no match distinctly from a provider failure', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse([]));

    await expect(geocodeAddress('asdkfjaslkdfj nonsense address')).resolves.toEqual({ outcome: 'not_found' });
  });

  it('reports a 429 as rate_limited, not as "no results" — the address may be perfectly fine', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ error: 'rate limited' }, 429));

    await expect(geocodeAddress('Rothschild 1')).resolves.toEqual({ outcome: 'rate_limited' });
  });

  it('reports a non-429 server error as unavailable', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ error: 'internal' }, 503));

    await expect(geocodeAddress('Rothschild 1')).resolves.toEqual({ outcome: 'unavailable' });
  });

  it('reports a malformed response as unavailable instead of throwing', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ not: 'an array' }));

    await expect(geocodeAddress('Rothschild 1')).resolves.toEqual({ outcome: 'unavailable' });
  });

  it('rejects an out-of-range coordinate from an otherwise well-formed provider result — never accepted as a successful match', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse([{ lat: '132.5', lon: '34.7748' }])); // latitude outside [-90, 90]

    await expect(geocodeAddress('Rothschild 1')).resolves.toEqual({ outcome: 'unavailable' });
  });

  it('rejects a non-numeric coordinate from the provider — never accepted as a successful match', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse([{ lat: 'not-a-number', lon: '34.7748' }]));

    await expect(geocodeAddress('Rothschild 1')).resolves.toEqual({ outcome: 'unavailable' });
  });

  it('reports a network failure as unavailable instead of throwing', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(geocodeAddress('Rothschild 1')).resolves.toEqual({ outcome: 'unavailable' });
  });

  it('returns not_found for an empty or whitespace-only address without making a request', async () => {
    await expect(geocodeAddress('   ')).resolves.toEqual({ outcome: 'not_found' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('never reads the device location — no navigator.geolocation call anywhere in this module', async () => {
    const getCurrentPosition = vi.fn();
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
    vi.mocked(fetch).mockResolvedValue(jsonResponse([{ lat: '32.0648', lon: '34.7748' }]));

    await geocodeAddress('Rothschild 1, Tel Aviv');

    expect(getCurrentPosition).not.toHaveBeenCalled();
  });
});

describe('geocodeAddress — timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('does not hang forever on a request that never settles — reports unavailable once the timeout fires', async () => {
    vi.stubGlobal('fetch', abortableFetchMock());

    const pending = geocodeAddress('Rothschild 1, Tel Aviv');
    const assertion = expect(pending).resolves.toEqual({ outcome: 'unavailable' });

    // Same bound as lib/auth/authApi.ts::REQUEST_TIMEOUT_MS — the project's
    // existing network-timeout convention, not a bespoke one for geocoding.
    await vi.advanceTimersByTimeAsync(10_000);

    await assertion;
  });

  it('does not fire before the timeout — a request that resolves in time is unaffected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        return new Promise((resolve) => {
          setTimeout(() => resolve(jsonResponse([{ lat: '32.0648', lon: '34.7748' }])), 1_000);
        });
      }),
    );

    const pending = geocodeAddress('Rothschild 1, Tel Aviv');
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(pending).resolves.toEqual({ outcome: 'found', lat: 32.0648, lng: 34.7748 });
  });

  it('a timed-out call does not block a fresh attempt afterward', async () => {
    vi.stubGlobal('fetch', abortableFetchMock());

    const first = geocodeAddress('Rothschild 1, Tel Aviv');
    const firstAssertion = expect(first).resolves.toEqual({ outcome: 'unavailable' });
    await vi.advanceTimersByTimeAsync(10_000);
    await firstAssertion;

    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse([{ lat: '32.0648', lon: '34.7748' }]))));
    await expect(geocodeAddress('Rothschild 1, Tel Aviv')).resolves.toEqual({ outcome: 'found', lat: 32.0648, lng: 34.7748 });
  });
});
