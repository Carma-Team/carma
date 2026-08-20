/**
 * @file BluetoothManager.ts
 * @owner May Hajbi — driving-sdk maintainer
 * @brief Classic Bluetooth device monitoring, Android only.
 * Lists OS-bonded devices and emits connect/disconnect for the chosen target device,
 * which is how a trip can start and end without the driver touching the phone.
 *
 * Responsibilities:
 *   1. List OS-bonded (paired) Bluetooth devices on this handset.
 *   2. Emit onConnect / onDisconnect when the target device connects or
 *      disconnects at the system level.
 *
 * Platform: Android only.
 * iOS Classic Bluetooth access requires an Apple MFi licence — see README.md.
 *
 * Requires a development build (expo-dev-client).
 * Not compatible with Expo Go.
 */

import { Platform, PermissionsAndroid, NativeModules, type Permission } from 'react-native';
import RNBluetoothClassic, {
  type BluetoothDevice as RNDevice,
  type BluetoothDeviceEvent,
} from 'react-native-bluetooth-classic';

/** True only when the native module is linked — requires a dev/production build, not Expo Go. */
const isBTNativeAvailable = (): boolean => !!NativeModules.RNBluetoothClassic;

export interface BluetoothDevice {
  id: string;   // MAC address on Android (e.g. "AA:BB:CC:DD:EE:FF")
  name: string;
}

export class BluetoothManager {
  private targetDeviceId: string | null = null;
  private readonly onConnect: () => void;
  private readonly onDisconnect: () => void;
  private connectSub: { remove: () => void } | null = null;
  private disconnectSub: { remove: () => void } | null = null;

  constructor(onConnect: () => void, onDisconnect: () => void) {
    this.onConnect = onConnect;
    this.onDisconnect = onDisconnect;
  }

  // ─── Target device ───────────────────────────────────────────────────────────

  public setTargetDevice(id: string | null): void {
    this.targetDeviceId = id;
  }

  public getTargetDevice(): string | null {
    return this.targetDeviceId;
  }

  // ─── Permissions ─────────────────────────────────────────────────────────────

  private async requestPermissions(): Promise<boolean> {
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

  // ─── Bonded devices ──────────────────────────────────────────────────────────

  /**
   * Returns the list of Bluetooth devices already paired to this Android handset.
   * Returns an empty array on iOS or when permissions are denied.
   */
  public async getBondedDevices(): Promise<BluetoothDevice[]> {
    if (Platform.OS !== 'android' || !isBTNativeAvailable()) return [];

    const granted = await this.requestPermissions();
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

  // ─── Connection check ────────────────────────────────────────────────────────

  /**
   * Returns true if this app holds an open RFCOMM socket to the target device.
   *
   * NOT a system-level check, despite what it looks like: the native module answers
   * from its own map of sockets the app opened itself, so a car stereo connected to
   * the handset always reads false here. Detecting that needs the Android A2DP
   * profile proxy, which the library doesn't expose.
   */
  public async checkCurrentConnection(): Promise<boolean> {
    if (Platform.OS !== 'android' || !this.targetDeviceId || !isBTNativeAvailable()) return false;

    try {
      const device = await RNBluetoothClassic.getConnectedDevice(this.targetDeviceId);
      return device !== null;
    } catch {
      return false;
    }
  }

  // ─── Monitoring ──────────────────────────────────────────────────────────────

  /**
   * Subscribes to system-level Bluetooth connect / disconnect broadcasts.
   * Android: ACTION_ACL_CONNECTED / ACTION_ACL_DISCONNECTED.
   *
   * Fires onConnect / onDisconnect only when the event matches targetDeviceId.
   * Event-driven — no polling, no background thread, minimal battery impact.
   *
   * Safe to call multiple times; subsequent calls before stopMonitoring() are no-ops.
   */
  public startMonitoring(): void {
    if (Platform.OS !== 'android') return;
    if (!isBTNativeAvailable()) {
      console.warn('[SDK] BT native module not linked — monitoring unavailable');
      return;
    }
    if (this.connectSub || this.disconnectSub) return;

    this.connectSub = RNBluetoothClassic.onDeviceConnected((event: BluetoothDeviceEvent) => {
      if (event.device?.address === this.targetDeviceId) {
        console.log('[SDK] Target BT device connected:', event.device.name);
        this.onConnect();
      }
    });

    this.disconnectSub = RNBluetoothClassic.onDeviceDisconnected((event: BluetoothDeviceEvent) => {
      if (event.device?.address === this.targetDeviceId) {
        console.log('[SDK] Target BT device disconnected:', event.device.name);
        this.onDisconnect();
      }
    });
  }

  /**
   * Removes all system event subscriptions.
   * Call when monitoring is no longer needed (feature disabled, app teardown).
   */
  public stopMonitoring(): void {
    this.connectSub?.remove();
    this.disconnectSub?.remove();
    this.connectSub = null;
    this.disconnectSub = null;
  }

  // ─── Support status ──────────────────────────────────────────────────────────

  /**
   * Returns why getBondedDevices() might return empty, for diagnostic UI.
   * nativeAvailable=false → running in Expo Go or native module not linked.
   */
  public async getBTSupportStatus(): Promise<{
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
      const granted     = await this.requestPermissions();
      return { nativeAvailable, btAvailable, btEnabled, permissionsGranted: granted };
    } catch {
      return { nativeAvailable, btAvailable: false, btEnabled: false, permissionsGranted: false };
    }
  }

  // ─── Debug helpers ───────────────────────────────────────────────────────────

  /** Fires onConnect directly. Use to test the trip-start flow without a physical BT device. */
  public simulateConnect(): void {
    this.onConnect();
  }

  /** Fires onDisconnect directly. Use to test the trip-end flow without a physical BT device. */
  public simulateDisconnect(): void {
    this.onDisconnect();
  }
}
