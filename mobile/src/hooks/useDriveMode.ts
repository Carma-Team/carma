/**
 * useDriveMode — manages the SDK's BT event subscription for the drive mode feature.
 *
 * The app registers as a native Bluetooth listener via DrivingSDK → BluetoothManager
 * → RNBluetoothClassic (ACTION_ACL_CONNECTED / ACTION_ACL_DISCONNECTED broadcasts).
 * No polling. When the target device connects, the SDK runs trip validation and then fires
 * sdk.startTrip(). When the device disconnects during an active trip, sdk.stopTrip() fires.
 * AppContext's sdk.onTripStart / sdk.onTripEnd handlers update React state accordingly.
 *
 * This hook's responsibilities:
 *   1. Activate / deactivate the SDK's BT listener when drive mode settings change.
 *   2. Notify the user via toast when a BT-triggered trip auto-starts.
 *   3. Expose drive mode status for UI consumers.
 */
import { useEffect, useRef } from 'react';
import { useApp } from '@/context/AppContext';
import { useTranslation } from '@/hooks/useTranslation';

export function useDriveMode() {
  const { user, sdk, tripState, addToast, btDevice } = useApp();
  const { t } = useTranslation();

  const driveModeEnabled = !!(user?.driveModeEnabled && btDevice);
  const prevActiveRef = useRef(tripState.isActive);

  // Register or remove the native BT event subscription whenever the drive mode
  // config changes (feature toggled on/off, paired device changed).
  // sdk.updateTargetDevice → btManager.setTargetDevice + btManager.startMonitoring/stopMonitoring.
  // startMonitoring is idempotent — safe to call if monitoring is already active.
  //
  // This is the only place that arms or disarms the listener. It used to read the
  // device off `user`, where nothing ever wrote it, so it disarmed on every run and
  // the subscription survived only because AppContext happened to re-arm afterwards.
  useEffect(() => {
    console.log('[BT-DEBUG] useDriveMode effect —',
      'hasUser:', !!user,
      '| user.driveModeEnabled:', user?.driveModeEnabled,
      '| btDevice:', JSON.stringify(btDevice));
    sdk.updateTargetDevice(driveModeEnabled && btDevice ? btDevice.id : null);
  }, [driveModeEnabled, btDevice, sdk]);

  // Toast: notify when a trip starts while drive mode is active.
  // Fires on both BT auto-start and manual start while drive mode is on.
  useEffect(() => {
    const prev = prevActiveRef.current;
    prevActiveRef.current = tripState.isActive;

    if (driveModeEnabled && !prev && tripState.isActive) {
      addToast({
        type: 'info',
        message: `${btDevice?.name ?? t('driving.defaultDeviceName')} ${t('driving.btConnected')}`,
      });
    }
  }, [tripState.isActive, driveModeEnabled, addToast, btDevice?.name]);

  return {
    driveModeEnabled,
    isAutoTripActive: driveModeEnabled && tripState.isActive,
  };
}
