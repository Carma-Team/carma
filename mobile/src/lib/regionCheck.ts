/**
 * @file regionCheck.ts
 * @owner May (Mobile & Frontend UI Lead)
 * @brief Israel-only region check. CARMA is Israel-only (team decision).
 * Given a fix already obtained by the SDK, reverse-geocodes it and reports whether
 * it's inside Israel. No permission request of its own — the caller already holds
 * one by the time it has a fix.
 */
import * as Location from 'expo-location';

export async function isRegionAllowed(lat: number, lng: number): Promise<boolean> {
  try {
    const [place] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
    if (place?.isoCountryCode && place.isoCountryCode !== 'IL') {
      return false;
    }
  } catch {
    // Geocoder unavailable — fail open rather than reject a trip on a transient error.
  }
  return true;
}
