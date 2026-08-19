/**
 * @fileoverview Unit tests for regionCheck — CAR-23 Israel-only enforcement
 */
let mockIsoCountryCode: string | null = 'IL';
let mockThrows = false;

jest.mock('expo-location', () => ({
  reverseGeocodeAsync: jest.fn(async () => {
    if (mockThrows) throw new Error('geocoder unavailable');
    return mockIsoCountryCode ? [{ isoCountryCode: mockIsoCountryCode }] : [];
  }),
}));

import { isRegionAllowed } from '@/lib/regionCheck';

describe('isRegionAllowed', () => {
  beforeEach(() => {
    mockIsoCountryCode = 'IL';
    mockThrows = false;
  });

  it('allows a fix inside Israel', async () => {
    expect(await isRegionAllowed(32, 34)).toBe(true);
  });

  it('blocks a fix outside Israel', async () => {
    mockIsoCountryCode = 'US';
    expect(await isRegionAllowed(40, -74)).toBe(false);
  });

  it('fails open when the geocoder returns no result', async () => {
    mockIsoCountryCode = null;
    expect(await isRegionAllowed(0, 0)).toBe(true);
  });

  it('fails open when the geocoder throws', async () => {
    mockThrows = true;
    expect(await isRegionAllowed(32, 34)).toBe(true);
  });
});
