/**
 * @fileoverview Unit tests for deviceSupport — CAR-23 region + capability gate
 */
let mockCapabilities = { hasAccelerometer: true, hasGyroscope: true, osSupported: true };
let mockPermissionStatus = 'granted';
let mockIsoCountryCode: string | null = 'IL';
let mockLocationThrows = false;

jest.mock('@/lib/driving-sdk/DeviceCapabilities', () => ({
  checkDeviceCapabilities: jest.fn(async () => mockCapabilities),
}));

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: mockPermissionStatus })),
  getCurrentPositionAsync: jest.fn(async () => {
    if (mockLocationThrows) throw new Error('GPS unavailable');
    return { coords: { latitude: 32, longitude: 34 } };
  }),
  reverseGeocodeAsync: jest.fn(async () => (mockIsoCountryCode ? [{ isoCountryCode: mockIsoCountryCode }] : [])),
}));

import { checkDeviceSupport } from '@/lib/deviceSupport';

describe('checkDeviceSupport', () => {
  beforeEach(() => {
    mockCapabilities = { hasAccelerometer: true, hasGyroscope: true, osSupported: true };
    mockPermissionStatus = 'granted';
    mockIsoCountryCode = 'IL';
    mockLocationThrows = false;
  });

  it('allows a supported device in Israel', async () => {
    expect(await checkDeviceSupport()).toEqual({ blocked: false });
  });

  it('blocks when a required sensor is missing', async () => {
    mockCapabilities = { ...mockCapabilities, hasGyroscope: false };
    expect(await checkDeviceSupport()).toEqual({ blocked: true, reason: 'capability' });
  });

  it('blocks when the OS version is below the floor', async () => {
    mockCapabilities = { ...mockCapabilities, osSupported: false };
    expect(await checkDeviceSupport()).toEqual({ blocked: true, reason: 'capability' });
  });

  it('blocks a device located outside Israel', async () => {
    mockIsoCountryCode = 'US';
    expect(await checkDeviceSupport()).toEqual({ blocked: true, reason: 'region' });
  });

  it('fails open when location permission is refused', async () => {
    mockPermissionStatus = 'denied';
    mockIsoCountryCode = 'US'; // would have blocked, but the region can't be checked at all
    expect(await checkDeviceSupport()).toEqual({ blocked: false });
  });

  it('fails open when the GPS fix throws', async () => {
    mockLocationThrows = true;
    expect(await checkDeviceSupport()).toEqual({ blocked: false });
  });
});
