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
import { isValidLatitude, isValidLongitude } from '@/lib/geo/coordinates';

// `Number(...)` alone is not a safe parser here: `Number(null)` and
// `Number('')` both evaluate to `0`, not `NaN`, so a provider result
// missing a coordinate (or sending it as an empty string) would silently
// pass the bounds check below as a "legitimate" 0,0 — the intersection of
// the equator and prime meridian, and not this business's location. Only a
// real number or a non-empty numeric string is accepted; anything else
// (null, undefined, '', whitespace, a boolean, an object) is rejected
// before it ever reaches `Number()`. An explicit `0` supplied as a real
// coordinate — a business that actually sits on the equator or prime
// meridian — still parses and validates correctly.
function parseProviderCoordinate(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

const BASE_URL = import.meta.env.VITE_GEOCODING_URL ?? 'https://nominatim.openstreetmap.org';

// Same convention as `lib/auth/authApi.ts::REQUEST_TIMEOUT_MS` — a hung
// geocode must not leave the applicant on the loading screen forever.
const REQUEST_TIMEOUT_MS = 10_000;

export type GeocodeOutcome =
  | { outcome: 'found'; lat: number; lng: number }
  | { outcome: 'not_found' }
  // Distinct from `not_found`: the address might be perfectly fine, the
  // service just refused this one call. Conflating the two would tell an
  // applicant their real address doesn't exist.
  | { outcome: 'rate_limited' }
  // Any other non-2xx, a malformed body, an out-of-range or non-finite
  // coordinate in an otherwise "successful" response, a timeout, or the
  // request never reaching the server at all (offline, DNS, CORS) — the
  // caller's recovery is the same for all of these: offer a retry, never
  // guess or accept a coordinate that cannot be a real place on Earth.
  | { outcome: 'unavailable' };

export async function geocodeAddress(address: string): Promise<GeocodeOutcome> {
  const trimmed = address.trim();
  if (!trimmed) return { outcome: 'not_found' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const url = `${BASE_URL}/search?format=jsonv2&limit=1&q=${encodeURIComponent(trimmed)}`;
    const res = await fetch(url, { signal: controller.signal });
    if (res.status === 429) return { outcome: 'rate_limited' };
    if (!res.ok) return { outcome: 'unavailable' };

    const results: unknown = await res.json();
    if (!Array.isArray(results)) return { outcome: 'unavailable' };
    if (results.length === 0) return { outcome: 'not_found' };

    const [first] = results as Array<{ lat?: unknown; lon?: unknown }>;
    const lat = parseProviderCoordinate(first.lat);
    const lng = parseProviderCoordinate(first.lon);
    // A missing/malformed value, or one outside real-world bounds, is not a
    // usable coordinate, whatever the reason — never forwarded as though it
    // were a successful match.
    if (lat === null || lng === null || !isValidLatitude(lat) || !isValidLongitude(lng)) return { outcome: 'unavailable' };

    return { outcome: 'found', lat, lng };
  } catch {
    // AbortError is this function's own timeout firing, not the caller's
    // — see REQUEST_TIMEOUT_MS above. Both this and a genuine network
    // failure land on the same recovery path (retry or set manually), so
    // they are not distinguished any further than `unavailable`.
    return { outcome: 'unavailable' };
  } finally {
    clearTimeout(timeout);
  }
}
