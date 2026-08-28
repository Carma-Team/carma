import { describe, it, expect, vi, beforeEach } from 'vitest';
import { geocodeAddress } from './geocoding';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
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
