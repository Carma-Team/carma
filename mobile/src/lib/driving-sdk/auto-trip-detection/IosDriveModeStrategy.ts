/**
 * @file auto-trip-detection/IosDriveModeStrategy.ts
 * @owner May Hajbi — driving-sdk maintainer
 * @brief Placeholder for iOS automatic trip detection. Detects nothing yet.
 *
 * iOS cannot use the Bluetooth route at all: Apple gates Classic Bluetooth behind an MFi
 * licence. The decided replacement is continuous background location — the movement itself
 * is the trigger, rather than any external event — which is why this file exists now: it is
 * the seam that decision needs, and leaving it empty is honest about the current behaviour.
 *
 * Until it is implemented, an iPhone starts trips from the manual button, exactly as before.
 * Nothing here guesses at that implementation.
 */

import { TripDetectionStrategy } from '@/lib/driving-sdk/auto-trip-detection/types';

export class IosDriveModeStrategy implements TripDetectionStrategy {
  public onDetected?: () => void;
  public onLost?: () => void;

  /** No target to set: nothing external is being watched. */
  public setTarget(_id: string | null): void {}

  public start(): void {}

  public stop(): void {}
}
