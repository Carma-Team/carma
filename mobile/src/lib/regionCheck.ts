/**
 * @file regionCheck.ts
 * @owner May (Mobile & Frontend UI Lead)
 * @brief Israel-only region check. CARMA is Israel-only (team decision).
 * Tests a fix the SDK already holds against an offline bounding box — no network,
 * no permission request of its own, and no dependency on a geocoder's answer.
 */

// A box rather than a reverse-geocode, deliberately: it works with roaming off, costs
// nothing, and never returns the disputed country code Apple and Google hand back for a
// West Bank or Gaza fix — which would silently discard a legitimate trip.
// Corners: Metula in the north, Eilat in the south, the Mediterranean west, the eastern
// border east. Rounded outward, so the box is slightly generous rather than slightly short.
const MIN_LAT = 29.45;
const MAX_LAT = 33.35;
const MIN_LNG = 34.25;
const MAX_LNG = 35.90;

export function isRegionAllowed(lat: number, lng: number): boolean {
  return lat >= MIN_LAT && lat <= MAX_LAT && lng >= MIN_LNG && lng <= MAX_LNG;
}
