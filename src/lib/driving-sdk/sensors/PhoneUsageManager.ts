/**
 * @fileoverview זיהוי שימוש בטלפון בזמן נסיעה — PhoneUsageManager
 * @module lib/driving-sdk/sensors/PhoneUsageManager
 *
 * @description
 * מאזין לשינויי AppState (active/background/inactive).
 * כשהאפליקציה עוברת לרקע או מסך נעול בזמן נסיעה — נרשם אירוע PHONE_USAGE.
 * מודד זמן רקע מצטבר (totalPhoneSeconds) לחישוב מדויק של penalty בנוסחת הניקוד.
 *
 * @remarks ללא קריאות שרת — לוגיקה מקומית בלבד.
 */
import { AppState, AppStateStatus } from 'react-native';
import { DrivingEventType, DrivingEvent } from '@/lib/driving-sdk/types';

export class PhoneUsageManager {
  private isActive: boolean = false;
  private onEvent: (event: DrivingEvent) => void;
  private onPhoneSeconds: (totalSeconds: number) => void;
  private subscription: any = null;
  private backgroundStartTime: number = 0;
  private totalPhoneSeconds: number = 0;

  constructor(
    onEvent: (event: DrivingEvent) => void,
    onPhoneSeconds: (totalSeconds: number) => void
  ) {
    this.onEvent = onEvent;
    this.onPhoneSeconds = onPhoneSeconds;
  }

  public start() {
    this.isActive = true;
    this.totalPhoneSeconds = 0;
    this.backgroundStartTime = 0;
    this.subscription?.remove();

    this.subscription = AppState.addEventListener('change', (nextState) => {
      this.handleStateChange(nextState);
    });

    console.log('[SDK-Phone] Started monitoring AppState. Current:', AppState.currentState);
  }

  public stop() {
    this.isActive = false;
    // If app is still in background when trip ends, capture the remaining time
    if (this.backgroundStartTime > 0) {
      const elapsed = (Date.now() - this.backgroundStartTime) / 1000;
      this.totalPhoneSeconds += elapsed;
      this.backgroundStartTime = 0;
    }
    this.subscription?.remove();
    this.subscription = null;
    console.log('[SDK-Phone] Stopped monitoring. Total phone seconds:', this.totalPhoneSeconds);
  }

  private handleStateChange(nextState: AppStateStatus) {
    if (!this.isActive) return;

    if (nextState === 'background' || nextState === 'inactive') {
      // Guard against iOS firing inactive → background sequentially (only start once)
      if (this.backgroundStartTime === 0) {
        this.backgroundStartTime = Date.now();
        this.onEvent({
          type: DrivingEventType.PHONE_USAGE,
          timestamp: new Date(),
          severity: 1.0,
        });
      }
    } else if (nextState === 'active') {
      if (this.backgroundStartTime > 0) {
        const elapsed = (Date.now() - this.backgroundStartTime) / 1000;
        this.totalPhoneSeconds += elapsed;
        this.backgroundStartTime = 0;
        console.log('[SDK-Phone] Phone returned foreground. Session elapsed:', elapsed.toFixed(1), 's. Total:', this.totalPhoneSeconds.toFixed(1), 's');
        this.onPhoneSeconds(this.totalPhoneSeconds);
      }
    }
  }
}
