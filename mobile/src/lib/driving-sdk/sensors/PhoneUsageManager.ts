/**
 * @fileoverview IMU-based active interaction detector — PhoneUsageManager v1.7
 * @module lib/driving-sdk/sensors/PhoneUsageManager
 *
 * @description
 * Detects active phone handling via IMU accelerometer-variance analysis and
 * a glass-tap transient proxy. Replaces a v1.x AppState-only approach that
 * caused false positives when the host app ran in the background behind
 * navigation apps (Waze, Google Maps) with the phone mounted on the dashboard.
 *
 * Two metrics emitted via onInteractionData callback:
 *   - touchEpochs              count of sharp single-sample acceleration transients
 *                               (glass-tap proxy; also fires on foreground touch events)
 *   - screenInteractionSeconds  seconds where IMU variance indicates a hand-held phone
 *                               (low variance = vehicle-mounted → not counted)
 *
 * @remarks Hardware-abstraction only. Threshold constants are IMU calibration values,
 * not app-specific scoring weights. They require empirical drive-test validation
 * before production launch.
 */
import { AppState, AppStateStatus } from 'react-native';
import { Accelerometer } from 'expo-sensors';
import { DrivingEventType, DrivingEvent } from '@/lib/driving-sdk/types';

// ── IMU calibration constants ─────────────────────────────────────────────────
//
// HANDHELD_VARIANCE_THRESHOLD (g²):
//   Phone on a vehicle mount → variance ~0.002–0.010 g² (road vibration only).
//   Phone hand-held          → variance ~0.030–0.150 g² (micro hand-movements).
//   0.025 g² gives a comfortable separation margin.
//   Requires empirical calibration before Sprint+1 — see RFC-001 §4.3.
const HANDHELD_VARIANCE_THRESHOLD = 0.025;

// GLASS_TAP_MAGNITUDE_THRESHOLD (g):
//   A finger tap on glass/screen produces a sharp transient of 1.8–3.0 g total
//   magnitude. Road bumps rarely reach 1.8 g with the same sharp onset profile.
//   The 1 500 ms inter-epoch cooldown prevents one physical tap from registering
//   multiple times across the 10 Hz sample stream.
const GLASS_TAP_MAGNITUDE_THRESHOLD = 1.8;
const EPOCH_COOLDOWN_MS = 1500;

// Rolling variance window: 10 samples at 10 Hz = 1-second analysis window.
const VARIANCE_WINDOW_SIZE = 10;

export interface InteractionData {
  touchEpochs: number;
  screenInteractionSeconds: number;
}

export class PhoneUsageManager {
  private isActive = false;
  private isBackground = false;
  private onEvent: (event: DrivingEvent) => void;
  private onInteractionData: (data: InteractionData) => void;
  private appStateSub: ReturnType<typeof AppState.addEventListener> | null = null;
  private accelSub: { remove: () => void } | null = null;

  private magnitudeWindow: number[] = [];
  private touchEpochs = 0;
  private screenInteractionSeconds = 0;
  private lastEpochMs = 0;
  private bgTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    onEvent: (event: DrivingEvent) => void,
    onInteractionData: (data: InteractionData) => void,
  ) {
    this.onEvent = onEvent;
    this.onInteractionData = onInteractionData;
  }

  public start(): void {
    this.isActive = true;
    this.touchEpochs = 0;
    this.screenInteractionSeconds = 0;
    this.lastEpochMs = 0;
    this.magnitudeWindow = [];
    this.appStateSub?.remove();

    this.isBackground = AppState.currentState !== 'active';
    this.appStateSub = AppState.addEventListener('change', (s) => this.handleAppState(s));

    Accelerometer.setUpdateInterval(100); // 10 Hz
    this.accelSub = Accelerometer.addListener(({ x, y, z }) => this.handleAccel(x, y, z));

    if (this.isBackground) this.startBgTimer();

    console.log('[SDK-Phone] v1.7 started. variance_threshold=', HANDHELD_VARIANCE_THRESHOLD);
  }

  public stop(): void {
    this.isActive = false;
    this.appStateSub?.remove();
    this.appStateSub = null;
    this.accelSub?.remove();
    this.accelSub = null;
    this.stopBgTimer();
    console.log(
      '[SDK-Phone] v1.7 stopped.',
      `touchEpochs=${this.touchEpochs}`,
      `screenInteractionSeconds=${this.screenInteractionSeconds}`,
    );
  }

  public getSnapshot(): InteractionData {
    return { touchEpochs: this.touchEpochs, screenInteractionSeconds: this.screenInteractionSeconds };
  }

  private handleAppState(nextState: AppStateStatus): void {
    if (!this.isActive) return;

    if ((nextState === 'background' || nextState === 'inactive') && !this.isBackground) {
      this.isBackground = true;
      this.startBgTimer();
      this.onEvent({ type: DrivingEventType.PHONE_USAGE, timestamp: new Date(), severity: 0.5 });
    } else if (nextState === 'active' && this.isBackground) {
      this.isBackground = false;
      this.stopBgTimer();
    }
  }

  private handleAccel(x: number, y: number, z: number): void {
    if (!this.isActive) return;
    const mag = Math.sqrt(x * x + y * y + z * z);

    this.magnitudeWindow.push(mag);
    if (this.magnitudeWindow.length > VARIANCE_WINDOW_SIZE) this.magnitudeWindow.shift();

    // Glass-tap proxy: sharp transient well above the resting ~1 g baseline.
    const now = Date.now();
    if (mag > GLASS_TAP_MAGNITUDE_THRESHOLD && now - this.lastEpochMs > EPOCH_COOLDOWN_MS) {
      this.touchEpochs++;
      this.lastEpochMs = now;
      this.onInteractionData({
        touchEpochs: this.touchEpochs,
        screenInteractionSeconds: this.screenInteractionSeconds,
      });
    }
  }

  private computeVariance(): number {
    const n = this.magnitudeWindow.length;
    if (n < 2) return 0;
    const mean = this.magnitudeWindow.reduce((s, v) => s + v, 0) / n;
    return this.magnitudeWindow.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  }

  private startBgTimer(): void {
    this.stopBgTimer();
    // Tick every second while backgrounded.
    // Only accumulate when IMU variance indicates the phone is hand-held.
    // Low variance (mounted phone navigating via Waze) → zero penalty.
    this.bgTimer = setInterval(() => {
      if (!this.isActive || !this.isBackground) return;
      if (this.computeVariance() > HANDHELD_VARIANCE_THRESHOLD) {
        this.screenInteractionSeconds++;
        this.onInteractionData({
          touchEpochs: this.touchEpochs,
          screenInteractionSeconds: this.screenInteractionSeconds,
        });
      }
    }, 1000);
  }

  private stopBgTimer(): void {
    if (this.bgTimer !== null) {
      clearInterval(this.bgTimer);
      this.bgTimer = null;
    }
  }
}
