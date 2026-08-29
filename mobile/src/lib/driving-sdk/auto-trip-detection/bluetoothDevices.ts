/**
 * @file auto-trip-detection/bluetoothDevices.ts
 * @owner May Hajbi — driving-sdk maintainer
 * @brief Android Bluetooth device listing and permissions, holding no monitoring state.
 * Answers the two questions a settings screen asks before any detection is armed:
 * which devices can be picked, and — when none can — why the list is empty.
 *
 * Separate from BluetoothDriveModeStrategy on purpose: these are stateless queries that
 * DrivingSDK exposes directly (getAvailableDevices / getBTSupportStatus), while the
 * strategy sits behind the platform-agnostic TripDetectionStrategy interface and cannot
 * carry Bluetooth-only methods without leaking Bluetooth into every platform.
 *
 * Platform: Android only. iOS Classic Bluetooth needs an Apple MFi licence — see README.md.
 * Requires a development build (expo-dev-client). Not compatible with Expo Go.
 */

import { Platform, PermissionsAndroid, NativeModules, type Permission } from 'react-native';
import RNBluetoothClassic, { type BluetoothDevice as RNDevice } from 'react-native-bluetooth-classic';
import { BluetoothDevice } from '@/lib/driving-sdk/types';

/** True only when the native module is linked — requires a dev/production build, not Expo Go. */
export const isBTNativeAvailable = (): boolean => !!NativeModules.RNBluetoothClassic;

export async function requestBTPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;

  // Android 12+ (API 31) replaces the location-based BT permission with explicit ones.
  const apiLevel = Platform.Version as number;
  const permissions: Permission[] = apiLevel >= 31
    ? [
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      ]
    : [
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ];

  const results = await PermissionsAndroid.requestMultiple(permissions);
  return Object.values(results).every(
    r => r === PermissionsAndroid.RESULTS.GRANTED
  );
}

/**
 * Returns the Bluetooth devices already paired to this Android handset.
 * Returns an empty array on iOS or when permissions are denied.
 */
export async function getBondedDevices(): Promise<BluetoothDevice[]> {
  if (Platform.OS !== 'android' || !isBTNativeAvailable()) return [];

  const granted = await requestBTPermissions();
  if (!granted) {
    console.warn('[SDK] Bluetooth permissions not granted');
    return [];
  }

  try {
    const available = await RNBluetoothClassic.isBluetoothAvailable();
    if (!available) return [];

    const enabled = await RNBluetoothClassic.isBluetoothEnabled();
    if (!enabled) return [];

    const bonded: RNDevice[] = await RNBluetoothClassic.getBondedDevices();
    return bonded.map(d => ({
      id: d.address,
      name: d.name ?? d.address,
    }));
  } catch (err) {
    console.warn('[SDK] getBondedDevices error:', err);
    return [];
  }
}

/**
 * Returns why getBondedDevices() might come back empty, for diagnostic UI.
 * nativeAvailable=false → running in Expo Go, or the native module is not linked.
 */
export async function getBTSupportStatus(): Promise<{
  nativeAvailable: boolean;
  btAvailable: boolean;
  btEnabled: boolean;
  permissionsGranted: boolean;
}> {
  const nativeAvailable = isBTNativeAvailable();
  if (Platform.OS !== 'android' || !nativeAvailable) {
    return { nativeAvailable, btAvailable: false, btEnabled: false, permissionsGranted: false };
  }
  try {
    const btAvailable = await RNBluetoothClassic.isBluetoothAvailable();
    const btEnabled   = btAvailable && await RNBluetoothClassic.isBluetoothEnabled();
    const granted     = await requestBTPermissions();
    return { nativeAvailable, btAvailable, btEnabled, permissionsGranted: granted };
  } catch {
    return { nativeAvailable, btAvailable: false, btEnabled: false, permissionsGranted: false };
  }
}
