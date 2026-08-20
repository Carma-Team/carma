/**
 * @file PowerManagement.ts
 * @owner May Hajbi — driving-sdk maintainer
 * @brief Detects the platform where OS background throttling can degrade GPS cadence,
 * and opens the system settings screen from which the user can lift it.
 * Holds no opinion on when to ask or what to say — that is host-app UX.
 *
 * @description
 * Background GPS reliability on Android depends on whether the OS is allowed to
 * throttle the app under Doze / battery-saver / OEM power management (Xiaomi,
 * Huawei, Samsung, etc. are known offenders — see driving-sdk/README.md,
 * "Waypoint cadence" — #17). Neither expo-location's accuracy tier nor
 * timeInterval/distanceInterval can override that throttling; the only lever is
 * the user manually exempting the app from battery optimization in device
 * settings. This module only detects the platform risk and opens system
 * settings — it has no opinion on when/whether to ask the user, or what to say;
 * that's app-specific UX and belongs outside driving-sdk/.
 */
import { Platform, Linking } from 'react-native';

/** True on platforms where OS-level background throttling can degrade GPS cadence during a trip. */
export function isBackgroundThrottlingRiskPlatform(): boolean {
  return Platform.OS === 'android';
}

/** Opens this app's OS settings screen, from which the user can reach battery/power settings. */
export function openAppSystemSettings(): Promise<void> {
  return Linking.openSettings();
}
