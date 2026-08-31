/**
 * The fraud abort, driven through DrivingSDK with the real TripValidationManager.
 *
 * tripValidation.test.ts drives the validator directly and DrivingSDK.test.ts drives the
 * SDK against a stub, so neither sees what the two do to each other: the abort calls
 * stop() on the validator from inside the tick that raised the verdict. A suppression
 * flag that does not survive that call reads as correct in both of those suites and is
 * dead in the app, which is the only wiring that exists (AppContext → DrivingSDK →
 * TripValidationManager).
 *
 * The hardware managers are mocked because this is about the validator/SDK seam. The
 * mock only has to hand back the sensor callback so a tick can be fed.
 */
import { DrivingSDK } from '@/lib/driving-sdk';
import { TripValidationManager } from '@/lib/TripValidationManager';
import { FraudDetector, FraudEvaluation } from '@/lib/FraudDetector';
import { SensorUpdate } from '@/lib/driving-sdk/types';
import { TransportMode } from '@/lib/transportMode';

let sendUpdate: (u: SensorUpdate) => void;

jest.mock('@/lib/driving-sdk/sensors/SensorManager', () => ({
  SensorManager: class {
    constructor(_onEvent: any, onUpdate: any) { sendUpdate = onUpdate; }
    async start() {}
    stop() {}
    resetSensorCoverage() {}
  },
}));

jest.mock('@/lib/driving-sdk/sensors/RawSampleRecorder', () => ({
  RawSampleRecorder: class {
    start() {} async stop() {} isRecording() { return false; }
    pushAccelSample() {} pushGyroSample() {} pushLocationSample() {}
  },
}));

jest.mock('@/lib/driving-sdk/sensors/PhoneUsageManager', () => ({
  PhoneUsageManager: class {
    constructor(_onEvent: any, _onData: any) {}
    start() {} stop() {} updateSpeed() {} pushGyroSample() {}
  },
}));

jest.mock('@/lib/driving-sdk/auto-trip-detection/AutoDriveModeManager', () => ({
  AutoDriveModeManager: class {
    constructor(_onDetected: any, _onLost: any) {}
    enable() {}
  },
}));

const TRAIN_VERDICT: FraudEvaluation = {
  score: 1,
  confidence: 1,
  isReady: true,
  mode: TransportMode.TRAIN,
  signals: { constantHighSpeed: true, noLateralForce: true, noHeadingChange: true },
  telemetry: { avgSpeedKmh: 82, maxLateralAccelG: 0.02, yawVariance: 0.001 },
};

// One second of travel at a steady 80 km/h, as the sensor layer would report it.
function tickAt80(): void {
  sendUpdate({
    distanceKm: 0.022,
    currentSpeed: 80,
    timeDeltaS: 1,
    accelX: 0.01,
    gyroZ: 0.001,
    accelAvailable: true,
    accelCoverage: 1,
    gyroAvailable: true,
    accelInitFailed: false,
    backgroundLocationAvailable: true,
  });
  jest.advanceTimersByTime(1000);
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('a manual restart on the same journey does not produce a second fraud report', async () => {
  jest.spyOn(FraudDetector.prototype, 'evaluate').mockReturnValue(TRAIN_VERDICT);
  const sdk = new DrivingSDK({ tripValidator: new TripValidationManager() });
  const onFraudDetected = jest.fn();
  sdk.onFraudDetected = onFraudDetected;

  // Rule 1's 30 seconds, then the verdict: the SDK aborts and stops the validator.
  await sdk.startTrip();
  for (let i = 0; i < 30; i++) tickAt80();
  expect(onFraudDetected).toHaveBeenCalledTimes(1);
  expect(sdk.getStatus().isActive).toBe(false);

  // The rider, whose trip just vanished without a word, starts one again — still moving,
  // still the same journey. §3.6 allows it one report, and it has had it.
  await sdk.startTrip();
  for (let i = 0; i < 30; i++) tickAt80();
  expect(onFraudDetected).toHaveBeenCalledTimes(1);
});
