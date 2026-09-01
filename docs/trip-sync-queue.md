# Trip sync queue — retry, backoff and retention

Current behaviour.

Owner of the code: Mobile.

A completed trip is uploaded to the server the moment it ends. When that upload fails, the
trip is held in a local queue on the phone so it is not lost. This document describes what
that queue does today.

---

## 1. How the queue works

- A trip that fails to upload is appended to a FIFO queue persisted on the device.
- The queue is flushed on two events only: app launch, and the app returning to the
  foreground. There is no retry while the app is open and in use.
- Each flush walks the queue in order and stops at the first item it cannot send. Items
  behind it are left untouched, so trips are never uploaded out of order.
- Every trip carries a client-generated id sent as an idempotency key, so a retry after a
  timeout cannot create a duplicate on the server.

## 2. What each server answer means

| Answer | What happens |
|---|---|
| Success | Removed from the queue. |
| 409 Conflict | Already stored server-side (idempotency match) — removed, treated as success. |
| 400, 401, 403, 422 | Permanent. The server will never accept this payload — removed. |
| 429 Too Many Requests | Transient. Retry is delayed by exactly what the server asked for. |
| 5xx, 408, no network | Transient. Retry is delayed by the backoff schedule. |

A 422 never reaches the queue at all — an implausible or unsigned trip is rejected at the
point of upload, shown to the driver, and audit-logged (RFC-001 §6).

## 3. Retry state — two counters, on purpose

Each queued trip carries two independent counters:

- **`backoffStep`** — how far into the backoff schedule this trip is. Grows on every
  transient failure and stops at the longest interval. It controls *when* the next attempt
  happens and nothing else.
- **`failures`** — how many times this trip has genuinely failed to upload. Recorded for
  observability; nothing reads it to decide whether to drop the trip (see §4 — that is
  governed by `queuedAt` alone).

They are not derivable from one another, because **a 429 advances the backoff but does not
count as a failure**. A rate limit is the server rationing capacity shared with every other
driver behind the same carrier NAT; it is not this trip's fault.

**Backoff schedule:** 1 minute → 5 minutes → 15 minutes → 1 hour, then held at 1 hour. On a
429 the server's `Retry-After` replaces the scheduled interval, falling back to the schedule
if a particular response omits it.

Sub-minute intervals were deliberately left out: an attempt only ever happens when the app
is launched or foregrounded, so finer granularity would add steps without changing behaviour.

## 4. Retention bound

A trip is held in the queue for up to 30 days (`MAX_QUEUE_AGE_MS`), measured from `queuedAt`
— the moment it was enqueued — not from the number of times an upload was attempted. An
attempt count would mean a different span of real time for every driver, since attempts only
accrue on app launch or foreground return; age reads a timestamp that is already stored and
does not depend on how often the app is opened.

30 days is tied to CARMA's own reward and voucher cycle, not to a published telematics
standard — no vendor publishes a retention bound for a local upload queue.

When a trip crosses the bound, it is removed from the sync queue but not deleted from the
device: `SyncManager` calls `onTripAbandoned`, and `AppContext` flags the trip `syncFailed`
in local storage. The trip stops being retried and stays out of the driver's synced history,
but the record itself survives.

---

*Related: CAR-138 (stopped the queue silently deleting a trip after five transient
failures), CAR-166 (settled the bound in this section), CAR-126 (server-side rate limiting —
the source of the 429 case), RFC-001 §6 (idempotency and the 422 contract).*
