# Trip sync queue — retry, backoff and retention

**Status:** current implementation, with three retention decisions still open (see §4).
Owner of the code: Mobile. Owner of the decisions in §4: the team.

A completed trip is uploaded to the server the moment it ends. When that upload fails, the
trip is held in a local queue on the phone so it is not lost. This document describes what
that queue does today, and the questions the current behaviour is standing in for.

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

## 4. Open decisions

Nothing in this project has ever documented how long an un-uploadable trip may live on a
driver's phone. Until CAR-138 the code answered it by accident: five transient failures and
the trip was deleted, silently, with no attempt to send it again. That was never a decision —
it was a line in a file header.

The current implementation replaces it with an explicit, deliberately generous bound so the
question is visible in one place instead of invisible in three. **The values below are
placeholders and are expected to change.**

### 4.1 What should bound local retention — attempt count, or age?

| | In code today | Alternative |
|---|---|---|
| Unit | Number of failed uploads | Age of the trip in the queue |
| Value | `MAX_FAILURES_BEFORE_DROP = 50` | e.g. 30 days |

An attempt count is hard to translate into real time: 50 attempts might be two days for one
driver and two months for another, because attempts only accrue on app launches. An age
limit is easier to reason about, easier to explain to a driver, and easier to hold the
server to. The field an age limit needs (`queuedAt`) is already stored on every item, so
switching units is a small change.

### 4.2 What is the value?

50 is not calibrated. It was chosen to sit far beyond any plausible outage while still
bounding local storage. If §4.1 lands on age instead, this number disappears entirely.

### 4.3 What happens when the bound is reached?

Today: the trip is deleted and a warning is logged. The alternative — surfacing a stuck trip
to the driver and letting them decide — is the answer offline-first practice usually gives,
but it needs UI, which CAR-138 placed explicitly out of scope.

Whichever way §4.1 and §4.2 land, deleting is still losing a trip the driver actually drove.
It is worth being deliberate about how often we are willing for that to happen.

## 5. What is ready for the decision

The bound lives in a single exported constant in `mobile/src/services/sync/SyncManager.ts`.
Changing its value is a one-line change. Changing its unit to age is a small one, because
the timestamp it would read is already persisted.

---

*Related: CAR-138 (the fix described here), CAR-126 (server-side rate limiting — the source
of the 429 case), RFC-001 §6 (idempotency and the 422 contract).*
