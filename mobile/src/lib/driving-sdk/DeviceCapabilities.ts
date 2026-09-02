/**
 * @file DeviceCapabilities.ts
 * @owner May Hajbi — driving-sdk maintainer
 * @brief Minimum device requirements: sensor availability and the OS version floor.
 * Does this device have the sensors the SDK subscribes to (see PLATFORM-CAPABILITIES.md),
 * and does it meet the OS floor the pinned Expo SDK itself imposes? Generic hardware/OS
 * facts only — what a host app does with a `false` result is its own decision, not
 * this module's.
 */
import { Platform } from 'react-native';
import { Accelerometer, Gyroscope } from 'expo-sensors';

// Floor imposed by expo ~54.0.34 itself (docs.expo.dev/versions/v54.0.0) — move
// these up only alongside an Expo SDK upgrade, not independently.
const MIN_IOS_VERSION = 15.1;
const MIN_ANDROID_API = 24;

export interface DeviceCapabilities {
  hasAccelerometer: boolean;
  hasGyroscope: boolean;
  osSupported: boolean;
}

export async function checkDeviceCapabilities(): Promise<DeviceCapabilities> {
  const [hasAccelerometer, hasGyroscope] = await Promise.all([
    Accelerometer.isAvailableAsync(),
    Gyroscope.isAvailableAsync(),
  ]);

  const osSupported = Platform.OS === 'android'
    ? Number(Platform.Version) >= MIN_ANDROID_API
    : parseFloat(String(Platform.Version)) >= MIN_IOS_VERSION;

  return { hasAccelerometer, hasGyroscope, osSupported };
}
