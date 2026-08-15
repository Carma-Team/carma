/**
 * @fileoverview Device/region access gate — deviceSupport
 * @module lib/deviceSupport
 *
 * @description
 * CARMA is Israel-only (team decision) and requires the sensors driving-sdk
 * consumes, on an OS at least as new as its floor. Runs once at app startup,
 * before login — CAR-23.
 */
import * as Location from 'expo-location';
import { checkDeviceCapabilities } from '@/lib/driving-sdk/DeviceCapabilities';

export type DeviceSupportResult =
  | { blocked: false }
  | { blocked: true; reason: 'region' | 'capability' };

export async function checkDeviceSupport(): Promise<DeviceSupportResult> {
  const capabilities = await checkDeviceCapabilities();
  if (!capabilities.hasAccelerometer || !capabilities.hasGyroscope || !capabilities.osSupported) {
    return { blocked: true, reason: 'capability' };
  }

  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    // A refused permission means the region can't be checked — fail open rather
    // than lock out a legitimate user for declining a prompt (SensorManager's
    // trip-start permission request is unaffected either way).
    if (status !== 'granted') return { blocked: false };

    const position = await Location.getCurrentPositionAsync({});
    const [place] = await Location.reverseGeocodeAsync(position.coords);
    if (place?.isoCountryCode && place.isoCountryCode !== 'IL') {
      return { blocked: true, reason: 'region' };
    }
  } catch {
    // GPS fix unavailable — fail open rather than block on a transient location error.
  }

  return { blocked: false };
}
