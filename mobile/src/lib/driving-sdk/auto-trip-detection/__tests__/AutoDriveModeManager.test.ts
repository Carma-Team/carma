// ─── Mocks ────────────────────────────────────────────────────────────────────
// Platform is mutable so both platform branches can be exercised without re-importing the
// module under test. The stores are `mock`-prefixed because jest hoists the factories above
// them and rejects any other out-of-scope name. Each strategy is replaced by a spy class:
// what this suite asserts is which one gets built and what it is told, never how
// either of them detects anything — that is their own suites' job.
const platform = { OS: 'android' };

jest.mock('react-native', () => ({
  get Platform() {
    return platform;
  },
}));

const mockBtInstances: any[] = [];
const mockIosInstances: any[] = [];

// Each store is referenced by name inside the constructor rather than captured as a
// parameter: jest hoists the factories above these declarations, so anything read at
// factory time is still undefined. By the time a constructor runs, they exist.
jest.mock('@/lib/driving-sdk/auto-trip-detection/BluetoothDriveModeStrategy', () => ({
  BluetoothDriveModeStrategy: class {
    onDetected?: () => void;
    onLost?: () => void;
    setTarget = jest.fn();
    start = jest.fn();
    stop = jest.fn();
    constructor() {
      mockBtInstances.push(this);
    }
  },
}));

jest.mock('@/lib/driving-sdk/auto-trip-detection/IosDriveModeStrategy', () => ({
  IosDriveModeStrategy: class {
    onDetected?: () => void;
    onLost?: () => void;
    setTarget = jest.fn();
    start = jest.fn();
    stop = jest.fn();
    constructor() {
      mockIosInstances.push(this);
    }
  },
}));

import { AutoDriveModeManager } from '@/lib/driving-sdk/auto-trip-detection/AutoDriveModeManager';

const TARGET = 'AA:BB:CC:DD:EE:FF';

describe('AutoDriveModeManager', () => {
  let onDetected: jest.Mock;
  let onLost: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockBtInstances.length = 0;
    mockIosInstances.length = 0;
    platform.OS = 'android';
    onDetected = jest.fn();
    onLost = jest.fn();
  });

  describe('strategy selection', () => {
    it('builds the Bluetooth strategy on Android', () => {
      new AutoDriveModeManager(onDetected, onLost);

      expect(mockBtInstances).toHaveLength(1);
      expect(mockIosInstances).toHaveLength(0);
    });

    it('builds the iOS strategy on iOS', () => {
      platform.OS = 'ios';

      new AutoDriveModeManager(onDetected, onLost);

      expect(mockIosInstances).toHaveLength(1);
      expect(mockBtInstances).toHaveLength(0);
    });
  });

  describe('callback wiring', () => {
    it('routes the strategy detection callbacks straight through', () => {
      new AutoDriveModeManager(onDetected, onLost);

      mockBtInstances[0].onDetected?.();
      mockBtInstances[0].onLost?.();

      expect(onDetected).toHaveBeenCalledTimes(1);
      expect(onLost).toHaveBeenCalledTimes(1);
    });
  });

  describe('enable', () => {
    it('sets the target and starts the strategy', () => {
      const manager = new AutoDriveModeManager(onDetected, onLost);

      manager.enable(TARGET);

      expect(mockBtInstances[0].setTarget).toHaveBeenCalledWith(TARGET);
      expect(mockBtInstances[0].start).toHaveBeenCalledTimes(1);
      expect(mockBtInstances[0].stop).not.toHaveBeenCalled();
    });

    it('stops the strategy when the target is cleared', () => {
      const manager = new AutoDriveModeManager(onDetected, onLost);
      manager.enable(TARGET);

      manager.enable(null);

      expect(mockBtInstances[0].setTarget).toHaveBeenLastCalledWith(null);
      expect(mockBtInstances[0].stop).toHaveBeenCalledTimes(1);
    });

    // The host calls this on every settings change, most of which changed nothing else.
    // The manager forwards each one rather than deduplicating: not subscribing twice is
    // the strategy's own guarantee, and hiding a repeat here would mask a broken one.
    it('forwards a repeated target without ever disarming', () => {
      const manager = new AutoDriveModeManager(onDetected, onLost);

      manager.enable(TARGET);
      manager.enable(TARGET);

      expect(mockBtInstances[0].start).toHaveBeenCalledTimes(2);
      expect(mockBtInstances[0].stop).not.toHaveBeenCalled();
    });
  });
});
