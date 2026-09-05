/**
 * @file eventRouting.ts
 * @owner May Hajbi — driving-sdk maintainer
 * @brief Decides which registered listeners hear about a detected event: the per-type
 * cooldown that collapses one physical manoeuvre into one report, and the conditions each
 * listener attached when it subscribed.
 * @description
 * Split out of `index.ts`, which carried the trip lifecycle, the sensor accumulation and
 * this in one file. This is the part that changes on its own schedule — cooldown windows
 * and listener conditions have moved twice without the lifecycle moving at all — and
 * every one of those changes used to land in the same file as everything else.
 *
 * What stayed behind: whether a trip is active at all, the warm-up guard that belongs to
 * starting one, and stamping speed and position onto the event. This class is handed an
 * event that has already been decided to be real, and answers only who hears it.
 */
import {
  DrivingEvent, DrivingEventType, ListenerToken, SensorEventCondition, SensorEventHandler,
} from '@/lib/driving-sdk/types';

// Matched to the 5 s window the consumer's server merges detections over. Widening the
// evaluation window to 5 s instead would average a short hard event below its own
// threshold and stop reporting it at all, so the merge happens after detection.
const COOLDOWN_MS = 5000;

export class EventRouter {
  private listeners = new Map<ListenerToken, {
    type: DrivingEventType;
    condition: SensorEventCondition;
    handler: SensorEventHandler;
  }>();

  // Per type on purpose: a sustained brake must not swallow a turn detected inside it.
  private lastEventTime: Partial<Record<DrivingEventType, number>> = {};

  public add(
    type: DrivingEventType,
    condition: SensorEventCondition,
    handler: SensorEventHandler,
  ): ListenerToken {
    const token: ListenerToken = Symbol('sensor-listener');
    this.listeners.set(token, { type, condition, handler });
    return token;
  }

  /** Remove a previously registered listener. No-op if the token is unknown. */
  public remove(token: ListenerToken): void {
    this.listeners.delete(token);
  }

  /**
   * Whether this event is far enough from the last of its own type to count, stamping it
   * as the new last when it is. PHONE_USAGE is exempt: it is reported as a duration the
   * host sums, not as a discrete manoeuvre, so collapsing two of them loses time rather
   * than removing a duplicate.
   */
  public passesCooldown(event: DrivingEvent): boolean {
    if (event.type === DrivingEventType.PHONE_USAGE) return true;
    const last = this.lastEventTime[event.type] ?? 0;
    if (event.timestamp.getTime() - last < COOLDOWN_MS) return false;
    this.lastEventTime[event.type] = event.timestamp.getTime();
    return true;
  }

  /**
   * Forgets every type's last event. Called when a trip starts: the cooldown exists to
   * collapse one manoeuvre into one report, and a manoeuvre cannot span two trips.
   * Registered listeners are untouched - they outlive a trip by design.
   */
  public resetCooldowns(): void {
    this.lastEventTime = {};
  }

  /** Every listener whose type matches and whose conditions the event satisfies. */
  public dispatch(event: DrivingEvent, speedKmh: number): void {
    for (const { type, condition, handler } of this.listeners.values()) {
      if (type !== event.type) continue;
      if (condition.minSpeedKmh !== undefined && speedKmh < condition.minSpeedKmh) continue;
      // severity only exists on PHONE_USAGE (CAR-156) — minSeverity is not a filter
      // motion events can satisfy, so it must not silently block them either.
      if (condition.minSeverity !== undefined && event.type === DrivingEventType.PHONE_USAGE
          && (event.severity ?? 0) < condition.minSeverity) continue;
      // One listener throwing must not cost the others their event, or the host its
      // trip: this runs inside a sensor callback.
      try { handler(event); } catch (e) { console.warn('[SDK] Listener threw:', e); }
    }
  }
}
