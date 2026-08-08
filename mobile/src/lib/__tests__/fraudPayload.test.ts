/**
 * What the device tells the server when it flags a session.
 *
 * tripValidation.test.ts proves the gates fire correctly. This proves the verdict
 * survives the journey to the server intact — the gates by name, the telemetry
 * under one name per value, and no field renamed on the way out (CAR-32).
 */
import { FraudDetector, FRAUD_SCORE_THRESHOLD } from '@/lib/FraudDetector';
import { TransportMode } from '@/lib/driving-sdk/types';
import { fraudApi, type FraudEventPayload } from '@/services/api/fraud.api';
import { request } from '@/services/api/client';

jest.mock('@/constants/serverConfig', () => ({ USE_REAL_SERVER: true }));
jest.mock('@/services/api/client', () => ({ request: jest.fn().mockResolvedValue({}) }));

const requestMock = request as jest.Mock;

function trainEvent(overrides: Partial<FraudEventPayload> = {}): FraudEventPayload {
  return {
    userId: 'u1',
    timestamp: '2026-08-01T09:00:00.000Z',
    detectedMode: TransportMode.TRAIN,
    fraudScore: 1.0,
    telemetry: { avgSpeedKmh: 82.4, maxLateralAccelG: 0.03, yawVariance: 0.001 },
    signals: { constantHighSpeed: true, noLateralForce: true, noHeadingChange: true },
    durationMs: 240_000,
    maxSpeedKmh: 96.2,
    ...overrides,
  };
}

async function postedBody(payload: FraudEventPayload): Promise<any> {
  await fraudApi.syncInvalidTrip(payload);
  return JSON.parse(requestMock.mock.calls[0][1].body);
}

beforeEach(() => requestMock.mockClear());

// ─── FraudDetector ───────────────────────────────────────────────────────────

describe('FraudDetector signals', () => {
  // Train profile: constant 80 km/h, no lateral jolt, no heading change.
  test('names each gate after the observation that set it', () => {
    const detector = new FraudDetector();
    for (let i = 0; i < 30; i++) detector.addSample(80 + (i % 2 ? 0.1 : -0.1), 0.01, 0.001);

    const { signals, score, mode } = detector.evaluate();

    expect(signals).toEqual({
      constantHighSpeed: true,
      noLateralForce: true,
      noHeadingChange: true,
    });
    expect(score).toBeGreaterThanOrEqual(FRAUD_SCORE_THRESHOLD);
    expect(mode).toBe(TransportMode.TRAIN);
  });

  // Urban driving: slow, with real cornering forces and steering.
  test('reports every gate closed for car-like motion', () => {
    const detector = new FraudDetector();
    for (let i = 0; i < 30; i++) detector.addSample(20 + (i % 5) * 8, 0.4, i % 2 ? 0.5 : -0.5);

    expect(detector.evaluate().signals).toEqual({
      constantHighSpeed: false,
      noLateralForce: false,
      noHeadingChange: false,
    });
  });
});

// ─── Wire payload ────────────────────────────────────────────────────────────

describe('syncInvalidTrip payload', () => {
  test('sends the evidence behind the verdict, not just the verdict', async () => {
    const body = await postedBody(trainEvent());

    expect(body.detection).toEqual({
      fraudScore: 1.0,
      detectedMode: TransportMode.TRAIN,
      signals: { constantHighSpeed: true, noLateralForce: true, noHeadingChange: true },
      telemetry: { avgSpeedKmh: 82.4, maxLateralAccelG: 0.03, yawVariance: 0.001 },
      maxSpeedKmh: 96.2,
      detectedAt: '2026-08-01T09:00:00.000Z',
    });
  });

  test('raises a flag per gate that fired, and none for the ones that did not', async () => {
    const body = await postedBody(
      trainEvent({
        fraudScore: 0.75,
        signals: { constantHighSpeed: true, noLateralForce: true, noHeadingChange: false },
      })
    );

    expect(body.anomalyFlags).toEqual([
      'TRANSPORT_MODE_TRAIN',
      'SIGNAL_CONSTANT_HIGH_SPEED',
      'SIGNAL_NO_LATERAL_FORCE',
    ]);
  });

  test('flags a near-certain verdict for triage', async () => {
    const body = await postedBody(trainEvent({ fraudScore: 0.95 }));

    expect(body.anomalyFlags).toContain('HIGH_FRAUD_SCORE');
  });

  test('carries distance for a mid-trip catch and omits it for a pre-trip one', async () => {
    expect((await postedBody(trainEvent({ distanceKm: 4.8 }))).distanceKm).toBe(4.8);

    requestMock.mockClear();
    expect((await postedBody(trainEvent())).distanceKm).toBeUndefined();
  });

  test('still posts when the SDK reports no signals', async () => {
    const body = await postedBody(trainEvent({ signals: undefined }));

    expect(body.anomalyFlags).toEqual(['TRANSPORT_MODE_TRAIN', 'HIGH_FRAUD_SCORE']);
    expect(body.detection.telemetry.yawVariance).toBe(0.001);
  });
});
