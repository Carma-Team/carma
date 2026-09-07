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
- One exception: an item that has failed three times in a row is stepped over rather than
  halted on, so a single trip the server will not take cannot block the ones behind it.
  It keeps its place at the head and is retried on every pass. See §5.
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
- **`failures`** — how many times this trip has genuinely failed to upload in a row. It
  decides when the trip stops holding up the queue behind it (§5) and nothing else. No
  counter deletes a trip.

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

A trip leaves the queue once it has been waiting 30 days, measured from when it was queued
(`MAX_QUEUE_AGE_MS` in `mobile/src/services/sync/SyncManager.ts`). Age, not attempt count: a
counter cannot tell a driver who has been offline for a fortnight from a payload the server
will never accept, and counting attempts is what once deleted real trips (CAR-138).

The trip is **abandoned, not deleted**. It leaves the queue and stops being retried, but the
row stays on the device flagged as never sent, and both the trip list and the trip detail
screen say so. Nothing the driver recorded is thrown away.

30 days follows our reward cycle. No telematics vendor publishes a TTL for a local upload
queue, so this is our number and not an industry one.

## 5. A trip the server will not take

The halt in §1 is what keeps uploads in order, and it also meant that one trip stuck at the
head blocked every trip behind it for as long as it stayed queued — under the age bound, up
to a month.

A flat retry cap does not fix that safely. To a counter on the head item, a long outage and a
payload the server refuses look identical, and capping on count is CAR-138 again.

So the queue does not guess. After three consecutive failures the head item is stepped over
and the rest of the queue is tried:

- **The network or the server is down.** The next item fails too and the pass halts there, one
  request later than it used to. Nothing is sent, and nothing has changed.
- **That one trip is the problem.** The items behind it succeed. Their success is the evidence
  that identifies the head as the broken one — which is what a counter on the head alone can
  never provide.

The stepped-over trip keeps its position, keeps being retried, and keeps ageing. The age bound
in §4 remains the only thing that ever removes it. A 429 does not count towards the three,
because a rate limit is shared with every other driver behind the same carrier NAT: the trips
behind the head would meet it too, so stepping over would spend a request to learn nothing.


---

*Related: CAR-138 (the fix described in §3), CAR-166 (the retention-bound decision behind §4),
CAR-311 (the stuck-head problem §5 answers), CAR-126 (server-side rate limiting — the source of
the 429 case), RFC-001 §6 (idempotency and the 422 contract).*
