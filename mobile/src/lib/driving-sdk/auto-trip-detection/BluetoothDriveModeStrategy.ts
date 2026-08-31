/**
 * @file auto-trip-detection/BluetoothDriveModeStrategy.ts
 * @owner May Hajbi — driving-sdk maintainer
 * @brief Detects vehicle travel from a paired Bluetooth device connecting. Android only.
 * Subscribes to the OS-level connect/disconnect broadcasts for one target device, which is
 * how a trip can start and end without the driver touching the phone.
 */

import { Platform } from 'react-native';
import RNBluetoothClassic, { type BluetoothDeviceEvent } from 'react-native-bluetooth-classic';
import { TripDetectionStrategy } from '@/lib/driving-sdk/auto-trip-detection/types';
import { isBTNativeAvailable } from '@/lib/driving-sdk/auto-trip-detection/bluetoothDevices';

export class BluetoothDriveModeStrategy implements TripDetectionStrategy {
  private targetDeviceId: string | null = null;
  private connectSub: { remove: () => void } | null = null;
  private disconnectSub: { remove: () => void } | null = null;

  public onDetected?: () => void;
  public onLost?: () => void;

  /** @param id MAC address on Android (e.g. "AA:BB:CC:DD:EE:FF"). */
  public setTarget(id: string | null): void {
    this.targetDeviceId = id;
  }

  /**
   * Subscribes to system-level Bluetooth connect / disconnect broadcasts.
   * Android: ACTION_ACL_CONNECTED / ACTION_ACL_DISCONNECTED.
   *
   * Reports only events matching the target device.
   * Event-driven — no polling, no background thread, minimal battery impact.
   *
   * Safe to call multiple times; subsequent calls before stop() are no-ops.
   */
  public start(): void {
    if (Platform.OS !== 'android') return;
    if (!isBTNativeAvailable()) {
      console.warn('[SDK] BT native module not linked — monitoring unavailable');
      return;
    }
    if (this.connectSub || this.disconnectSub) return;

    this.connectSub = RNBluetoothClassic.onDeviceConnected((event: BluetoothDeviceEvent) => {
      if (event.device?.address === this.targetDeviceId) {
        console.log('[SDK] Target BT device connected:', event.device.name);
        this.onDetected?.();
      }
    });

    this.disconnectSub = RNBluetoothClassic.onDeviceDisconnected((event: BluetoothDeviceEvent) => {
      if (event.device?.address === this.targetDeviceId) {
        console.log('[SDK] Target BT device disconnected:', event.device.name);
        this.onLost?.();
      }
    });
  }

  /**
   * Removes all system event subscriptions.
   * Call when detection is no longer needed (feature disabled, app teardown).
   */
  public stop(): void {
    this.connectSub?.remove();
    this.disconnectSub?.remove();
    this.connectSub = null;
    this.disconnectSub = null;
  }
}
