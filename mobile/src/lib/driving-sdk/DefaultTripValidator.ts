/**
 * @file DefaultTripValidator.ts
 * @owner May Hajbi — driving-sdk maintainer
 * @brief The no-op `TripValidator` the SDK falls back to when the host supplies none.
 * Confirms a trip immediately and never evaluates suspicion, so the library works
 * standalone with zero configuration.
 *
 * @description
 * Used by DrivingSDK whenever SDKConfig.tripValidator is not supplied, so the SDK
 * works standalone with zero configuration: start() confirms the trip immediately,
 * stop() is a no-op, and suspicious-activity is never evaluated. Apps that need
 * "only count it as a trip after N seconds of sustained movement" or transport-mode
 * fraud detection should implement TripValidator and pass their own instance via
 * SDKConfig.tripValidator instead of editing this file.
 */
import { ValidationSample, TripValidator, SuspiciousActivityEvaluation } from '@/lib/driving-sdk/types';

export class DefaultTripValidator implements TripValidator {
  public onTripConfirmed?: () => void;
  public onTripEnded?: () => void;
  public onFraudSuspected?: (evaluation: SuspiciousActivityEvaluation) => void;

  start(): void {
    this.onTripConfirmed?.();
  }

  stop(): void {
    // No ongoing monitoring to tear down — trips only end via DrivingSDK.stopTrip().
  }

  updateSample(_sample: ValidationSample): void {
    // No-op — the default validator does not evaluate samples.
  }
}
