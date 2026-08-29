/**
 * @fileoverview Latitude/longitude bounds shared by the geocoding client and
 * the map confirm/correct UI (CAR-203) — one definition of "valid" for both
 * a provider's result and a manually typed value.
 * @module lib/geo/coordinates
 */
const LATITUDE_MIN = -90;
const LATITUDE_MAX = 90;
const LONGITUDE_MIN = -180;
const LONGITUDE_MAX = 180;

export function isValidLatitude(value: number): boolean {
  return Number.isFinite(value) && value >= LATITUDE_MIN && value <= LATITUDE_MAX;
}

export function isValidLongitude(value: number): boolean {
  return Number.isFinite(value) && value >= LONGITUDE_MIN && value <= LONGITUDE_MAX;
}

export function isValidCoordinate(lat: number, lng: number): boolean {
  return isValidLatitude(lat) && isValidLongitude(lng);
}
