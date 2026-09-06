/**
 * @file auto-trip-detection/AutoDriveModeManager.ts
 * @owner May Hajbi — driving-sdk maintainer
 * @brief Owns the one active trip-detection strategy and picks it per platform.
 * Turns whatever that strategy noticed into the two calls DrivingSDK cares about, so
 * nothing above this class knows whether the trigger was Bluetooth, movement, or anything else.
 */

import { Platform } from 'react-native';
import { TripDetectionStrategy } from '@/lib/driving-sdk/auto-trip-detection/types';
import { BluetoothDriveModeStrategy } from '@/lib/driving-sdk/auto-trip-detection/BluetoothDriveModeStrategy';
import { IosDriveModeStrategy } from '@/lib/driving-sdk/auto-trip-detection/IosDriveModeStrategy';

/**
 * One strategy per platform, chosen once at construction. Not configurable by the host:
 * which mechanism a platform can even use is a property of the platform, not a preference
 * — Android has the Bluetooth broadcasts, iOS does not.
 */
function createStrategy(): TripDetectionStrategy {
  return Platform.OS === 'android'
    ? new BluetoothDriveModeStrategy()
    : new IosDriveModeStrategy();
}

export class AutoDriveModeManager {
  private readonly strategy: TripDetectionStrategy;

  constructor(onDetected: () => void, onLost: () => void) {
    this.strategy = createStrategy();
    this.strategy.onDetected = onDetected;
    this.strategy.onLost = onLost;
  }

  /**
   * Arms detection for `target`, or disarms it when null. Idempotent — the host calls this
   * on every settings change, including ones that did not actually change the target.
   *
   * A null target disarming detection is a Bluetooth-shaped rule: there, no device means
   * nothing to listen for. A movement-based strategy has nothing to target and would want
   * to run regardless — revisit here, not in the strategy, when iOS detection lands.
   */
  public enable(target: string | null): void {
    this.strategy.setTarget(target);
    if (target) this.strategy.start();
    else this.strategy.stop();
  }

  /**
   * The vehicle connected right now, or null. Null also covers a strategy that cannot
   * answer the question at all — the caller wants "which vehicle", and "this platform
   * has no way to tell" and "none" lead to the same place.
   */
  public getConnectedVehicleId(): string | null {
    return this.strategy.getConnectedVehicleId?.() ?? null;
  }
}
