import { AppState, AppStateStatus } from 'react-native';
import { DrivingEventType, DrivingEvent } from '@/lib/driving-sdk/types';

export class PhoneUsageManager {
  private isActive: boolean = false;
  private onEvent: (event: DrivingEvent) => void;
  private subscription: any = null;
  private lastEventTime: number = 0;

  constructor(onEvent: (event: DrivingEvent) => void) {
    this.onEvent = onEvent;
  }

  public start() {
    this.isActive = true;
    this.subscription?.remove();

    this.subscription = AppState.addEventListener('change', (nextState) => {
      this.handleStateChange(nextState);
    });

    console.log('[SDK-Phone] Started monitoring AppState. Current:', AppState.currentState);
  }

  public stop() {
    this.isActive = false;
    this.subscription?.remove();
    this.subscription = null;
    console.log('[SDK-Phone] Stopped monitoring');
  }

  private handleStateChange(nextState: AppStateStatus) {
    if (!this.isActive) return;

    // זיהוי יציאה מהאפליקציה (רקע או מסך נעול)
    if (nextState === 'background' || nextState === 'inactive') {
      const now = Date.now();
      // מניעת כפילויות (Cooldown של 3 שניות)
      if (now - this.lastEventTime > 3000) {
        this.lastEventTime = now;
        console.log('[SDK-Phone] App moved to background/inactive - triggering event');
        this.onEvent({
          type: DrivingEventType.PHONE_USAGE,
          timestamp: new Date(),
          severity: 1.0
        });
      }
    }
  }
}
