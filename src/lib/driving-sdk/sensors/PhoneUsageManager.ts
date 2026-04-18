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

    // We no longer trigger events here because AppContext handles it.
    // This manager is kept for future expansion if needed, but inactive for now.
    console.log('[SDK-Phone] State changed to (ignored):', nextState);
  }
}
