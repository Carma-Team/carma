/**
 * @fileoverview Forward-geocode a free-text address to coordinates, so the
 * applicant never has to place a pin as their primary way of giving a
 * location (CAR-203).
 * @module lib/api/geocoding
 *
 * @description
 * Talks to a Nominatim-compatible search endpoint — no API key, no signup
 * (see the CAR-203 hand-off for the provider comparison). The base URL comes
 * from `VITE_GEOCODING_URL`, not a hardcoded constant: the public instance
 * this defaults to is approved for the pilot only, has no SLA, and caps the
 * whole app at an aggregate 1 request/second — see the PR description for
 * the full policy. Swapping to a self-hosted instance, or a different
 * Nominatim-compatible provider, is a config change; only the response
 * shape parsed below would need to change for a provider with a different
 * one. `fetch` cannot set a custom `User-Agent` or `Referer` (both are
 * forbidden request headers in browsers), which is fine: a real browser
 * already sends its own real ones on every request. One call per address
 * confirmation, never per keystroke, keeps a single user's traffic well
 * under the policy's per-second cap; see the PR description for why that is
 * not the same as bounding the app's aggregate traffic, which nothing
 * client-side can do.
 */
const BASE_URL = import.meta.env.VITE_GEOCODING_URL ?? 'https://nominatim.openstreetmap.org';

export type GeocodeOutcome =
  | { outcome: 'found'; lat: number; lng: number }
  | { outcome: 'not_found' }
  // Distinct from `not_found`: the address might be perfectly fine, the
  // service just refused this one call. Conflating the two would tell an
  // applicant their real address doesn't exist.
  | { outcome: 'rate_limited' }
  // Any other non-2xx, a malformed body, or the request never reaching the
  // server at all (offline, DNS, CORS) — the caller's recovery is the same
  // for all three: offer a retry, never guess a coordinate.
  | { outcome: 'unavailable' };

export async function geocodeAddress(address: string): Promise<GeocodeOutcome> {
  const trimmed = address.trim();
  if (!trimmed) return { outcome: 'not_found' };

  try {
    const url = `${BASE_URL}/search?format=jsonv2&limit=1&q=${encodeURIComponent(trimmed)}`;
    const res = await fetch(url);
    if (res.status === 429) return { outcome: 'rate_limited' };
    if (!res.ok) return { outcome: 'unavailable' };

    const results: unknown = await res.json();
    if (!Array.isArray(results)) return { outcome: 'unavailable' };
    if (results.length === 0) return { outcome: 'not_found' };

    const [first] = results as Array<{ lat?: unknown; lon?: unknown }>;
    const lat = Number(first.lat);
    const lng = Number(first.lon);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return { outcome: 'unavailable' };

    return { outcome: 'found', lat, lng };
  } catch {
    return { outcome: 'unavailable' };
  }
}
