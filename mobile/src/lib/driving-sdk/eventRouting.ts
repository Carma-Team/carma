/**
 * @file eventRouting.ts
 * @owner May Hajbi — driving-sdk maintainer
 * @brief Decides which registered listeners hear about a detected event: the two
 * cooldowns that collapse one physical manoeuvre into one report, and the conditions each
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
    // When this listener last actually heard an event, so its own window starts from
    // something it was told about rather than from one it was held back from.
    lastDispatchedAt: number;
  }>();

  // Per type on purpose: a sustained brake must not swallow a turn detected inside it.
  private lastEventTime: Partial<Record<DrivingEventType, number>> = {};

  public add(
    type: DrivingEventType,
    condition: SensorEventCondition,
    handler: SensorEventHandler,
  ): ListenerToken {
    const token: ListenerToken = Symbol('sensor-listener');
    this.listeners.set(token, { type, condition, handler, lastDispatchedAt: 0 });
    return token;
  }

  /** Remove a previously registered listener. No-op if the token is unknown. */
  public remove(token: ListenerToken): void {
    this.listeners.delete(token);
  }

  /**
   * Whether this event is far enough from the last of its own type to be *reported*,
   * stamping it as the new last when it is. This one governs what the trip stores and
   * nothing else — a listener is gated by its own cooldown in `dispatch`, after its
   * conditions (CAR-300). PHONE_USAGE is exempt: it is reported as a duration the host
   * sums, not as a discrete manoeuvre, so collapsing two of them loses time rather than
   * removing a duplicate.
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
    for (const listener of this.listeners.values()) listener.lastDispatchedAt = 0;
  }

  /**
   * Every listener whose type matches, whose conditions the event satisfies, and whose
   * own cooldown has elapsed.
   *
   * The cooldown is stamped here rather than shared with `passesCooldown`, and only
   * after the conditions above (CAR-300). A single per-type stamp was set before them,
   * so a turn dropped by a listener's speed gate still sealed that type and swallowed
   * the qualifying turn three seconds later. It is per listener rather than per type
   * because `minSpeedKmh` is a per-listener threshold: with two listeners on one type
   * at different thresholds, "passed the gate" has no one answer.
   */
  public dispatch(event: DrivingEvent, speedKmh: number): void {
    const at = event.timestamp.getTime();
    for (const listener of this.listeners.values()) {
      const { type, condition, handler } = listener;
      if (type !== event.type) continue;
      if (condition.minSpeedKmh !== undefined && speedKmh < condition.minSpeedKmh) continue;
      // severity only exists on PHONE_USAGE (CAR-156) — minSeverity is not a filter
      // motion events can satisfy, so it must not silently block them either.
      if (condition.minSeverity !== undefined && event.type === DrivingEventType.PHONE_USAGE
          && (event.severity ?? 0) < condition.minSeverity) continue;
      // Exempt for the same reason it is exempt from the report cooldown: phone usage is
      // a duration the host sums, so collapsing two of them loses time.
      if (event.type !== DrivingEventType.PHONE_USAGE) {
        if (at - listener.lastDispatchedAt < COOLDOWN_MS) continue;
        listener.lastDispatchedAt = at;
      }
      // One listener throwing must not cost the others their event, or the host its
      // trip: this runs inside a sensor callback.
      try { handler(event); } catch (e) { console.warn('[SDK] Listener threw:', e); }
    }
  }
}
