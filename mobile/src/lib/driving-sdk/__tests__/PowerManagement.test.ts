// ─── Mocks ────────────────────────────────────────────────────────────────────
// Same shape as auto-trip-detection/__tests__/bluetoothDetection.test.ts: Platform sits behind a getter so every
// branch runs without re-importing the module under test. openSettings stays a bare
// jest.fn so the test can assert the promise is passed through, not re-wrapped.
//
// Both members must be getters. jest.mock() is hoisted above the consts below, and
// the factory runs the moment react-native is first required — while importing the
// module under test, before those consts are assigned. A plain `Linking: { ... }`
// captures undefined there; a getter reads the const at access time, once it exists.
const platform = { OS: 'android' };
const mockOpenSettings = jest.fn(() => Promise.resolve());

jest.mock('react-native', () => ({
  get Platform() {
    return platform;
  },
  get Linking() {
    return { openSettings: mockOpenSettings };
  },
}));

import {
  isBackgroundThrottlingRiskPlatform,
  openAppSystemSettings,
} from '@/lib/driving-sdk/PowerManagement';

describe('isBackgroundThrottlingRiskPlatform', () => {
  it('reports the risk on Android, where Doze and OEM power management throttle background GPS', () => {
    platform.OS = 'android';

    expect(isBackgroundThrottlingRiskPlatform()).toBe(true);
  });

  it('reports no risk on iOS, so a host does not prompt for an exemption that does not exist there', () => {
    platform.OS = 'ios';

    expect(isBackgroundThrottlingRiskPlatform()).toBe(false);
  });

  it('reports no risk on any other platform, rather than defaulting to the Android answer', () => {
    platform.OS = 'web';

    expect(isBackgroundThrottlingRiskPlatform()).toBe(false);
  });
});

describe('openAppSystemSettings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('opens the settings screen for this app, taking no argument that could point elsewhere', () => {
    void openAppSystemSettings();

    expect(mockOpenSettings).toHaveBeenCalledTimes(1);
    expect(mockOpenSettings).toHaveBeenCalledWith();
  });

  it('hands back the promise Linking returned, so a caller can await the screen actually opening', async () => {
    const opening = Promise.resolve();
    mockOpenSettings.mockReturnValueOnce(opening);

    expect(openAppSystemSettings()).toBe(opening);

    await opening;
  });
});
