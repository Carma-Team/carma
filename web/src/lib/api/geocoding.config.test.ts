import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

// Separate file, not a case inside geocoding.test.ts: the base URL is read
// once, at module load — proving it is configurable needs a fresh module
// instance per env value, which `vi.resetModules` + a dynamic `import()`
// gives, but mixing that with the static-import tests above would make
// their shared module state (and mocks) order-dependent.
describe('geocodeAddress — provider URL is a config point, not a hardcoded Nominatim coupling', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to the public Nominatim instance when unset', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse([{ lat: '1', lon: '2' }]));
    const { geocodeAddress } = await import('./geocoding');

    await geocodeAddress('some address');

    expect(vi.mocked(fetch).mock.calls[0][0]).toContain('nominatim.openstreetmap.org');
  });

  it('calls whatever endpoint VITE_GEOCODING_URL names instead, with no code change', async () => {
    vi.stubEnv('VITE_GEOCODING_URL', 'https://self-hosted-geocoder.internal');
    vi.mocked(fetch).mockResolvedValue(jsonResponse([{ lat: '1', lon: '2' }]));
    const { geocodeAddress } = await import('./geocoding');

    await geocodeAddress('some address');

    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(url).toContain('https://self-hosted-geocoder.internal');
    expect(url).not.toContain('nominatim.openstreetmap.org');
  });
});
