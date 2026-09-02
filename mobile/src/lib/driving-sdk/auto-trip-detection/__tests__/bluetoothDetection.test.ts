// ─── Mocks ────────────────────────────────────────────────────────────────────
// Platform and NativeModules are mutable so the Android-only and Expo-Go paths
// can both be exercised without re-importing the module under test.
const platform = { OS: 'android', Version: 33 };
const nativeModules: { RNBluetoothClassic?: object } = { RNBluetoothClassic: {} };

jest.mock('react-native', () => ({
  get Platform() {
    return platform;
  },
  get NativeModules() {
    return nativeModules;
  },
  PermissionsAndroid: {
    PERMISSIONS: {
      BLUETOOTH_SCAN: 'BLUETOOTH_SCAN',
      BLUETOOTH_CONNECT: 'BLUETOOTH_CONNECT',
      ACCESS_FINE_LOCATION: 'ACCESS_FINE_LOCATION',
    },
    RESULTS: { GRANTED: 'granted' },
    requestMultiple: jest.fn(async (permissions: string[]) =>
      Object.fromEntries(permissions.map((p) => [p, 'granted'])),
    ),
  },
}));

type Handler = (event: unknown) => void;
let mockConnectHandler: Handler | null = null;
let mockDisconnectHandler: Handler | null = null;
const mockRemoveConnect = jest.fn();
const mockRemoveDisconnect = jest.fn();

jest.mock('react-native-bluetooth-classic', () => ({
  __esModule: true,
  default: {
    onDeviceConnected: jest.fn((handler: Handler) => {
      mockConnectHandler = handler;
      return { remove: mockRemoveConnect };
    }),
    onDeviceDisconnected: jest.fn((handler: Handler) => {
      mockDisconnectHandler = handler;
      return { remove: mockRemoveDisconnect };
    }),
    isBluetoothAvailable: jest.fn(async () => true),
    isBluetoothEnabled: jest.fn(async () => true),
    getBondedDevices: jest.fn(async () => [
      { address: 'AA:BB:CC:DD:EE:FF', name: 'Car Stereo' },
      { address: '11:22:33:44:55:66', name: null },
    ]),
  },
}));

import { BluetoothDriveModeStrategy } from '@/lib/driving-sdk/auto-trip-detection/BluetoothDriveModeStrategy';
import { getBondedDevices } from '@/lib/driving-sdk/auto-trip-detection/bluetoothDevices';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TARGET = 'AA:BB:CC:DD:EE:FF';
const OTHER = '11:22:33:44:55:66';

/**
 * The exact shape the native module emits: the device is nested, not spread.
 * Reading `address` off the top level is the bug this file exists to catch.
 */
function deviceEvent(address: string, eventType: string) {
  return {
    device: { address, name: 'Car Stereo', bonded: true },
    eventType,
    timestamp: '2026-08-06T00:00:00.000Z',
  };
}

describe('BluetoothDriveModeStrategy', () => {
  let onConnect: jest.Mock;
  let onDisconnect: jest.Mock;
  let strategy: BluetoothDriveModeStrategy;

  beforeEach(() => {
    jest.clearAllMocks();
    mockConnectHandler = null;
    mockDisconnectHandler = null;
    platform.OS = 'android';
    nativeModules.RNBluetoothClassic = {};

    onConnect = jest.fn();
    onDisconnect = jest.fn();
    strategy = new BluetoothDriveModeStrategy();
    strategy.onDetected = onConnect;
    strategy.onLost = onDisconnect;
  });

  describe('event payload shape', () => {
    it('fires onConnect when the nested device address matches the target', () => {
      strategy.setTarget(TARGET);
      strategy.start();

      mockConnectHandler?.(deviceEvent(TARGET, 'DEVICE_CONNECTED'));

      expect(onConnect).toHaveBeenCalledTimes(1);
    });

    it('fires onDisconnect when the nested device address matches the target', () => {
      strategy.setTarget(TARGET);
      strategy.start();

      mockDisconnectHandler?.(deviceEvent(TARGET, 'DEVICE_DISCONNECTED'));

      expect(onDisconnect).toHaveBeenCalledTimes(1);
    });

    // Regression guard: the address used to be read off the top level of the
    // event, where it is always undefined. Both callbacks stayed silent forever
    // and nothing failed — not tsc, not a test, not the app.
    it('ignores an event carrying the address at the top level instead of under device', () => {
      strategy.setTarget(TARGET);
      strategy.start();

      mockConnectHandler?.({ address: TARGET, name: 'Car Stereo' });

      expect(onConnect).not.toHaveBeenCalled();
    });

    it('survives an event with no device payload at all', () => {
      strategy.setTarget(TARGET);
      strategy.start();

      expect(() => mockConnectHandler?.({ eventType: 'DEVICE_CONNECTED' })).not.toThrow();
      expect(onConnect).not.toHaveBeenCalled();
    });
  });

  describe('target matching', () => {
    it('ignores a device that is not the target', () => {
      strategy.setTarget(TARGET);
      strategy.start();

      mockConnectHandler?.(deviceEvent(OTHER, 'DEVICE_CONNECTED'));
      mockDisconnectHandler?.(deviceEvent(OTHER, 'DEVICE_DISCONNECTED'));

      expect(onConnect).not.toHaveBeenCalled();
      expect(onDisconnect).not.toHaveBeenCalled();
    });

    it('follows the target when it changes while monitoring is live', () => {
      strategy.setTarget(TARGET);
      strategy.start();
      strategy.setTarget(OTHER);

      mockConnectHandler?.(deviceEvent(OTHER, 'DEVICE_CONNECTED'));

      expect(onConnect).toHaveBeenCalledTimes(1);
    });

    it('matches nothing once the target is cleared', () => {
      strategy.setTarget(TARGET);
      strategy.start();
      strategy.setTarget(null);

      mockConnectHandler?.(deviceEvent(TARGET, 'DEVICE_CONNECTED'));

      expect(onConnect).not.toHaveBeenCalled();
    });
  });

  describe('subscription lifecycle', () => {
    it('subscribes once even when start() is called repeatedly', () => {
      const RNBluetoothClassic = require('react-native-bluetooth-classic').default;

      strategy.setTarget(TARGET);
      strategy.start();
      strategy.start();
      strategy.start();

      expect(RNBluetoothClassic.onDeviceConnected).toHaveBeenCalledTimes(1);
      expect(RNBluetoothClassic.onDeviceDisconnected).toHaveBeenCalledTimes(1);
    });

    it('removes both subscriptions on stop()', () => {
      strategy.setTarget(TARGET);
      strategy.start();
      strategy.stop();

      expect(mockRemoveConnect).toHaveBeenCalledTimes(1);
      expect(mockRemoveDisconnect).toHaveBeenCalledTimes(1);
    });

    it('can be re-armed after stop()', () => {
      const RNBluetoothClassic = require('react-native-bluetooth-classic').default;

      strategy.setTarget(TARGET);
      strategy.start();
      strategy.stop();
      strategy.start();

      expect(RNBluetoothClassic.onDeviceConnected).toHaveBeenCalledTimes(2);
    });

    it('does not subscribe on iOS', () => {
      const RNBluetoothClassic = require('react-native-bluetooth-classic').default;
      platform.OS = 'ios';

      strategy.setTarget(TARGET);
      strategy.start();

      expect(RNBluetoothClassic.onDeviceConnected).not.toHaveBeenCalled();
    });

    it('does not subscribe when the native module is missing (Expo Go)', () => {
      const RNBluetoothClassic = require('react-native-bluetooth-classic').default;
      delete nativeModules.RNBluetoothClassic;

      strategy.setTarget(TARGET);
      strategy.start();

      expect(RNBluetoothClassic.onDeviceConnected).not.toHaveBeenCalled();
    });
  });

  describe('surviving a target with no listener attached', () => {
    // onDetected/onLost are optional on the interface, so a strategy armed before the
    // strategy wires them must not throw when the broadcast arrives.
    it('does not throw when an event fires with no callbacks set', () => {
      const bare = new BluetoothDriveModeStrategy();
      bare.setTarget(TARGET);
      bare.start();

      expect(() => mockConnectHandler?.(deviceEvent(TARGET, 'DEVICE_CONNECTED'))).not.toThrow();
    });
  });
});

describe('bluetoothDevices', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    platform.OS = 'android';
    nativeModules.RNBluetoothClassic = {};
  });

  describe('getBondedDevices', () => {
    it('maps the native address onto id and falls back to the address for a nameless device', async () => {
      const devices = await getBondedDevices();

      expect(devices).toEqual([
        { id: TARGET, name: 'Car Stereo' },
        { id: OTHER, name: OTHER },
      ]);
    });

    it('returns an empty list on iOS', async () => {
      platform.OS = 'ios';

      await expect(getBondedDevices()).resolves.toEqual([]);
    });

    it('returns an empty list when Bluetooth is switched off', async () => {
      const RNBluetoothClassic = require('react-native-bluetooth-classic').default;
      RNBluetoothClassic.isBluetoothEnabled.mockResolvedValueOnce(false);

      await expect(getBondedDevices()).resolves.toEqual([]);
    });
  });
});
