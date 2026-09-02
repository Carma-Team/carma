/**
 * @file auto-trip-detection/types.ts
 * @owner May Hajbi — driving-sdk maintainer
 * @brief The contract every automatic trip-detection method implements.
 * One strategy is active at a time, picked per platform, and DrivingSDK never learns which.
 */

/**
 * A way of noticing — without the driver touching the phone — that vehicle travel has
 * begun, and later that the signal for it is gone.
 *
 * Android watches a paired Bluetooth device connect. iOS cannot: Apple gates Classic
 * Bluetooth behind an MFi licence, so it watches movement itself. Everything above this
 * interface is identical for both, which is the whole reason it exists.
 */
export interface TripDetectionStrategy {
  /**
   * What to watch for, in whatever terms the strategy understands — a Bluetooth MAC
   * address on Android. `null` means there is nothing to watch, which makes start() a
   * no-op. A strategy that needs no target ignores this.
   */
  setTarget(id: string | null): void;

  /** Begin watching. Idempotent — a second call before stop() must not subscribe twice. */
  start(): void;

  /** Stop watching and release every subscription. Safe to call when not started. */
  stop(): void;

  /** Vehicle travel appears to have begun. */
  onDetected?: () => void;

  /**
   * The signal that started it is gone. Deliberately not "the trip ended" — whether it
   * did is the host TripValidator's call, and this strategy has no way to know.
   */
  onLost?: () => void;
}
