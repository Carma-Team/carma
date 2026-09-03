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
- **`failures`** — how many times this trip has genuinely failed to upload. It is the only
  counter that can delete a trip.

They are not derivable from one another, because **a 429 advances the backoff but does not
count as a failure**. A rate limit is the server rationing capacity shared with every other
driver behind the same carrier NAT; it is not this trip's fault, and it must not bring the
trip closer to deletion.

**Backoff schedule:** 1 minute → 5 minutes → 15 minutes → 1 hour, then held at 1 hour. On a
429 the server's `Retry-After` replaces the scheduled interval, falling back to the schedule
if a particular response omits it.

Sub-minute intervals were deliberately left out: an attempt only ever happens when the app
is launched or foregrounded, so finer granularity would add steps without changing behaviour.

## 4. Retention bound

A trip is dropped from the queue once it has failed to upload `MAX_FAILURES_BEFORE_DROP = 50`
times (`mobile/src/services/sync/SyncManager.ts`). It is deleted and a warning is logged — the
driver is not shown that it happened. The value is a placeholder, chosen to sit far beyond any
plausible outage while still bounding local storage; it was never calibrated (see CAR-138,
which stopped it from being five).

CAR-166 has since settled what replaces it: the bound becomes the trip's age in the queue
(`queuedAt`), not its attempt count, at 30 days — and a trip that crosses it is abandoned, not
deleted, so the record survives on the device even though it stops being retried. That decision
is not implemented yet; §4 will change again when it lands.

---

*Related: CAR-138 (the fix described here), CAR-166 (the retention-bound decision, not yet
implemented), CAR-126 (server-side rate limiting — the source of the 429 case), RFC-001 §6
(idempotency and the 422 contract).*
