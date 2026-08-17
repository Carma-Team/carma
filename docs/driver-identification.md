# Driver Identification — Technical Specification

**Target architecture.**

| | |
|---|---|
| **Document** | `driver-identification.md` |
| **Version** | 1.0 |
| **Owner** | Dan Ofri (CPO) — anti-fraud mechanics |
| **Authority** | Normative for occupancy classification, co-travel detection, and their enforcement. Inherits the enforcement ladder, principles P1–P6, and transport-mode classification from [fraud-detection.md](fraud-detection.md); **where the two disagree, `fraud-detection.md` wins.** |
| **Normative sections** | 1 – 8 |
| **Non-normative** | Appendices A, B, C |

The key words MUST, MUST NOT, SHALL, SHOULD, SHOULD NOT, and MAY in sections 1–8 are to be
interpreted as described in RFC 2119. Appendices are explanatory and contain no requirements.

---

## 1. Objective and scope

### 1.1 Objective

Determine whether the owner of the phone that recorded a trip was the person driving, and
withhold reward for trips where they were not.

### 1.2 Problem decomposition

| Term | Definition | In scope |
|---|---|---|
| **Occupancy** | Whether this phone's owner drove this trip | **Yes** — the deliverable |
| **Attribution** | Which of several candidate people drove a given vehicle | **No** — data model only (§3.4) |

### 1.3 Out of scope

- Transport-mode classification (train, bus, metro) — specified in [fraud-detection.md](fraud-detection.md) §3.
- Payload integrity, signing, and replay protection — [fraud-detection.md](fraud-detection.md) §4.
- iOS occupancy detection. Android only for all phases.
- Vehicle-resident hardware (BLE beacon). Deferred; see §7 Phase 5.

### 1.4 Success criteria

| Criterion | Requirement |
|---|---|
| Specificity (non-driver trips correctly identified), per user | ≥ `MIN_OCCUPANCY_SPECIFICITY` |
| Flag rate per user | ≤ `MAX_FLAG_RATE_PER_USER` |
| Trips falsely paired by co-travel where both parties drove | ≤ `MAX_FALSE_PAIR_RATE` |
| Evaluation sample | ≥ `MIN_LABELLED_PASSENGER_TRIPS` labelled passenger trips before any figure above is published |

Accuracy MUST NOT be used as a success criterion. Rationale: Appendix C.1.

---

## 2. Architecture and system design

### 2.1 Component overview

```
 CLIENT (Android)                          SERVER (FastAPI)
┌──────────────────────────┐              ┌────────────────────────────────────┐
│ Trip recording           │  POST /trips │ ① Existing gates (unchanged)       │
│  + vehicleKeyHash  ──────┼─────────────►│    idempotency → drift → signature │
│                          │              │    → plausibility → score → persist│
│ Occupancy prompt (D2)    │              └───────────────┬────────────────────┘
│  POST /trips/{id}/       │◄─── flag ───┐                │ enqueue
│       occupancy          │             │                ▼
└──────────────────────────┘             │  ┌──────────────────────────────────┐
                                         │  │ OccupancyEvaluator (async)       │
                                         │  │  L1 vehicle binding      §2.3.1  │
                                         └──┤  L2 co-travel matcher    §2.3.2  │
                                            │  L3 behavioural class.   §2.3.3  │
                                            │         ↓                        │
                                            │  trip_occupancy row      §3.2    │
                                            │  reversal attempt        §4.3    │
                                            └──────────────────────────────────┘
```

### 2.2 Execution model — normative

1. Occupancy evaluation MUST run asynchronously, after trip persistence.
2. Occupancy evaluation MUST NOT block, delay, or alter the `POST /api/trips` response.
3. Occupancy evaluation MUST NOT be a gate in the request pipeline defined in
   [fraud-detection.md](fraud-detection.md) §4.1.
4. A failure in occupancy evaluation MUST leave the trip scored, paid, and unflagged
   (principle P1).
5. Occupancy evaluation MUST be idempotent per trip. Re-evaluation MUST overwrite the prior
   record rather than append.

### 2.3 The three layers

| Layer | Name | Determinism | Max enforcement rung | Phase |
|---|---|---|---|---|
| L1 | Vehicle binding | Deterministic | Corroborator only | 1 |
| L2 | Co-travel detection | Deterministic | 2 | 2 |
| L3 | Behavioural classification | Probabilistic | 1 | 3–4 |

#### 2.3.1 L1 — Vehicle binding

The client MUST send `vehicleKeyHash` on every trip where a Bluetooth device was connected at
trip start.

| Requirement | |
|---|---|
| Value | `HMAC-SHA256(VEHICLE_KEY_SALT, mac_address)`, hex, truncated to 32 chars |
| Raw MAC | MUST NOT be transmitted, logged, or stored |
| Absent device | Field MUST be `null`, MUST NOT be an empty string or a sentinel |
| Salt rotation | MUST invalidate all stored keys; rotation is a migration, not a config change |

L1 produces one of three states, and MUST NOT produce any other:

| State | Condition |
|---|---|
| `KNOWN_VEHICLE` | `vehicleKeyHash` matches a key this account has used ≥ `VEHICLE_KEY_MIN_TRIPS` times |
| `UNKNOWN_VEHICLE` | Non-null hash with no qualifying history |
| `NO_BINDING` | `vehicleKeyHash` is null |

L1 MUST NOT alone set any enforcement rung. It is a resolver for L2 (§4.2) and a feature for L3.

**Hands-free-profile discrimination is explicitly excluded from all phases.**
`react-native-bluetooth-classic` exposes ACL connect/disconnect only, not per-profile state;
reading profile state requires the Android profile proxy, which the library does not expose —
the same limitation recorded on `BluetoothManager.checkCurrentConnection()`. Any
proposal to use HFP MUST first deliver a native module and MUST validate the assumption that
head units in the target fleet bind hands-free to a single handset.

#### 2.3.2 L2 — Co-travel detection

Two trips form a **co-travel pair** when all conditions in the table hold.

| # | Condition | Expression |
|---|---|---|
| 1 | Distinct owners | `a.user_id != b.user_id` |
| 2 | Start alignment | `abs(a.started_at - b.started_at) <= COTRAVEL_TIME_TOLERANCE_S` |
| 3 | End alignment | `abs(a.ended_at - b.ended_at) <= COTRAVEL_TIME_TOLERANCE_S` |
| 4 | Distance agreement | `abs(a.distance_km - b.distance_km) / max(a,b) <= COTRAVEL_DISTANCE_TOLERANCE` |
| 5 | Spatial overlap | `min(overlap(a,b), overlap(b,a)) >= COTRAVEL_TRACE_OVERLAP_MIN` |
| 6 | Stop alignment | `stop_alignment(a,b) >= COTRAVEL_STOP_ALIGNMENT_MIN` |

**`overlap(x, y)`** is the fraction of `x`'s waypoints whose great-circle distance to the
nearest waypoint in `y` is ≤ `COTRAVEL_WAYPOINT_RADIUS_M`.

Condition 5 MUST be evaluated in both directions and both values MUST be stored. A
one-directional test matches a short trip against the long trip that contains it.

**`stop_alignment(x, y)`** is the Jaccard index of the two trips' stop sets, where a stop is a
maximal run of waypoints below `COTRAVEL_STOP_SPEED_KMH` and two stops match when their
midpoints fall within `COTRAVEL_STOP_TIME_TOLERANCE_S`.

Condition 6 is mandatory and MUST NOT be omitted as an optimisation. Conditions 1–5 alone
match two vehicles travelling in convoy — colleagues driving separately along the same road at
the same time — in which case **both parties are driving** and a reversal would be a false
positive against an honest user. Two phones in one chassis stop at identical instants; two
vehicles in convoy diverge at signals and gaps.

**A pair means at most one occupant was driving. It does not mean exactly one was.** Resolution
logic MUST NOT assume a driver exists within the pair (§4.2).

#### 2.3.3 L3 — Behavioural classification

Deferred to Phase 4. Inputs, when built:

| Family | Observation | Independent of | Phase |
|---|---|---|---|
| F1 | Entry manoeuvre; door side from gyroscope rotation | All others | 4 — blocked, see below |
| F2 | Lateral asymmetry of centripetal acceleration across turns | F1, F4, F5 | 4 |
| F3 | Right-leg micro-motion, pocketed phones only | F1, F2, F5 | 4 |
| F4 | Phone-handling freedom | Partially F2 | 4 |
| F5 | Deviation from the account's own travel baseline | All others | 3 |

Requirements:

1. All families MUST consume vehicle-frame quantities resolved per
   [fraud-detection.md](fraud-detection.md) §3.2. Raw device axes MUST NOT be used.
2. No family MAY read engine vibration or engine-generated electromagnetic interference.
   Rationale: Appendix C.4.
3. F5 MUST emit `UNKNOWN` below `BASELINE_MIN_TRIPS` samples.
4. Where per-window verdicts within one trip conflict, the trip verdict MUST be `UNKNOWN`.
   A majority vote MUST NOT be taken. Rationale: a mid-journey driver swap has two correct
   answers.
5. **F1 is blocked on CAR-164.** Entry-manoeuvre detection requires the SDK to be sensing
   before trip start, which is unavailable until cold-start detection is resolved.

### 2.4 Data flow constraints

1. Raw sensor traces MUST NOT leave the device for occupancy purposes. Window aggregates only.
2. Co-travel evidence MUST reference account identifiers only. It MUST NOT be surfaced to
   either user, and MUST NOT be used to infer a relationship, household, or address.
3. Occupancy records MUST be deleted `EVIDENCE_RETENTION_MONTHS` after creation by a scheduled
   job, matching [fraud-detection.md](fraud-detection.md) P6.

---

## 3. API and data models

### 3.1 Client → server: trip payload addition

One field is added to the existing trip request DTO in `server/app/schemas/trip.py`.

```python
class SaveTripIn(CamelModel):
    # ... existing fields unchanged ...

    vehicle_key_hash: str | None = Field(
        default=None,
        validation_alias=AliasChoices("vehicleKeyHash", "vehicle_key_hash"),
        min_length=32,
        max_length=32,
        pattern=r"^[0-9a-f]{32}$",
        description=(
            "HMAC-SHA256 of the connected Bluetooth MAC, salted server-side key, "
            "hex, truncated to 32 chars. Null when no device was connected."
        ),
    )
```

**Contract synchronisation is mandatory and is part of the same pull request:**
`cd mobile && npm run gen:api`, then commit the regenerated
`mobile/src/services/api/generated.ts`. `schema-drift` in `ci-mobile.yml` fails the build
otherwise. The generator requires a server on `:3000` running against `requirements-dev.txt`
pins.

`vehicle_key_hash` MUST NOT be included in the signed telemetry digest. It is not a scoring
input, and adding it would break signature compatibility with deployed clients.

### 3.2 Server-internal: the occupancy record

New module `server/app/schemas/occupancy.py`. These models are **server-authored**: no client
submits them. Enums are therefore safe here, unlike `FraudDetection.detected_mode`
in `server/app/schemas/fraud.py`, which stays an open string because clients extend it.

```python
from __future__ import annotations

import enum
from datetime import datetime

from pydantic import Field, model_validator

from app.schemas._base import CamelModel


class OccupancyVerdict(str, enum.Enum):
    DRIVER = "DRIVER"
    PASSENGER = "PASSENGER"
    UNKNOWN = "UNKNOWN"


class OccupancySource(str, enum.Enum):
    COTRAVEL = "COTRAVEL"        # resolved pair, §2.3.2
    CLASSIFIER = "CLASSIFIER"    # probabilistic, §2.3.3
    DECLARED = "DECLARED"        # user volunteered, unprompted
    ANSWERED = "ANSWERED"        # user answered a flag prompt


class BindingState(str, enum.Enum):
    KNOWN_VEHICLE = "KNOWN_VEHICLE"
    UNKNOWN_VEHICLE = "UNKNOWN_VEHICLE"
    NO_BINDING = "NO_BINDING"


class PairResolution(str, enum.Enum):
    BINDING = "BINDING"
    ANSWER = "ANSWER"
    UNRESOLVED = "UNRESOLVED"


class ReversalOutcome(str, enum.Enum):
    APPLIED = "APPLIED"
    BALANCE_INSUFFICIENT = "BALANCE_INSUFFICIENT"
    WINDOW_EXPIRED = "WINDOW_EXPIRED"
    NOT_ATTEMPTED = "NOT_ATTEMPTED"


class OccupancySignals(CamelModel):
    """Tri-state per signal. None is UNKNOWN and MUST NOT be coerced to False."""

    binding: BindingState
    lateral_asymmetry: bool | None = None
    baseline_deviation: bool | None = None
    entry_side_driver: bool | None = None


class CoTravelEvidence(CamelModel):
    paired_trip_id: str = Field(max_length=32)
    paired_user_id: str = Field(max_length=32)
    overlap_forward: float = Field(ge=0.0, le=1.0)
    overlap_reverse: float = Field(ge=0.0, le=1.0)
    stop_alignment: float = Field(ge=0.0, le=1.0)
    resolved_by: PairResolution


class ReversalRecord(CamelModel):
    """Recorded even when nothing was reversed — the gap between attempted and
    applied is the number that decides whether a settlement delay is worth building.
    """

    outcome: ReversalOutcome
    points_targeted: float = Field(ge=0.0)
    points_reversed: float = Field(ge=0.0)
    attempted_at: datetime

    @model_validator(mode="after")
    def _partial_reversals_are_forbidden(self) -> ReversalRecord:
        if self.outcome is ReversalOutcome.APPLIED:
            if self.points_reversed != self.points_targeted:
                raise ValueError("APPLIED requires a full reversal; partials are forbidden")
        elif self.points_reversed != 0.0:
            raise ValueError("points_reversed must be 0.0 unless outcome is APPLIED")
        return self


class OccupancyRecord(CamelModel):
    trip_id: str = Field(max_length=32)
    verdict: OccupancyVerdict
    source: OccupancySource
    likelihood: float | None = Field(default=None, ge=0.0, le=1.0)
    calibration_version: str = Field(max_length=32)
    enforcement_rung: int = Field(ge=0, le=4)
    signals: OccupancySignals
    co_travel: CoTravelEvidence | None = None
    reversal: ReversalRecord | None = None
    excluded_from_driver_score: bool = False
    evaluated_at: datetime

    @model_validator(mode="after")
    def _human_answers_carry_no_likelihood(self) -> OccupancyRecord:
        human = {OccupancySource.DECLARED, OccupancySource.ANSWERED}
        if self.source in human and self.likelihood is not None:
            raise ValueError("a human answer is a fact, not a probability")
        if self.source is OccupancySource.COTRAVEL and self.co_travel is None:
            raise ValueError("COTRAVEL source requires co_travel evidence")
        return self

    @model_validator(mode="after")
    def _probabilistic_verdicts_cannot_exceed_rung_1(self) -> OccupancyRecord:
        if self.source is OccupancySource.CLASSIFIER and self.enforcement_rung > 1:
            raise ValueError("a probabilistic verdict may not exceed rung 1 (§4.1)")
        if self.enforcement_rung == 3:
            raise ValueError("rung 3 is unreachable for occupancy evidence (§4.1)")
        return self
```

The three validators are the enforcement of §4.1 in code rather than in prose. They MUST NOT
be removed to accommodate a caller.

### 3.3 Client-facing endpoints

| Method | Path | Purpose | Auth |
|---|---|---|---|
| `POST` | `/api/trips/{trip_id}/occupancy` | User declares or answers | Trip owner only |
| `GET` | `/api/trips/{trip_id}/occupancy` | Read the verdict for display | Trip owner only |

```python
class OccupancyDeclarationIn(CamelModel):
    """User-submitted. `was_driving=False` is the passenger declaration."""

    was_driving: bool
    prompted: bool = Field(
        description="True when answering a flag prompt, False when volunteered unprompted."
    )


class OccupancyOut(CamelModel):
    """Deliberately narrower than OccupancyRecord — see the constraint below."""

    trip_id: str
    verdict: OccupancyVerdict
    excluded_from_driver_score: bool
    points_reversed: float
    appeal_available: bool
```

`OccupancyOut` MUST NOT expose `co_travel`, `likelihood`, `signals`, or `calibration_version`.
`paired_user_id` identifies a third party (§2.4.2), and exposing signals or thresholds hands a
tuning oracle to anyone probing the detector.

### 3.4 Database requirements

Four migrations. All are Alembic revisions under `server/alembic/`.

#### M1 — `trip_occupancy` table

| Column | Type | Constraints |
|---|---|---|
| `trip_id` | `String(32)` | PK, FK → `trips.id` `ON DELETE CASCADE` |
| `verdict` | `String(16)` | NOT NULL |
| `source` | `String(16)` | NOT NULL |
| `likelihood` | `Float` | NULL |
| `calibration_version` | `String(32)` | NOT NULL |
| `enforcement_rung` | `SmallInteger` | NOT NULL, `CHECK (enforcement_rung BETWEEN 0 AND 4 AND enforcement_rung <> 3)` |
| `signals` | `JSONB` | NOT NULL |
| `co_travel` | `JSONB` | NULL |
| `reversal` | `JSONB` | NULL |
| `excluded_from_driver_score` | `Boolean` | NOT NULL, default `false` |
| `evaluated_at` | `DateTime(timezone=True)` | NOT NULL, `server_default=now()` |

One row per trip, not per evaluation — §2.2.5 requires overwrite semantics.

The `CHECK` constraint is deliberate: rung 3 is unreachable for occupancy evidence, and a
database constraint survives a service refactor that a Pydantic validator does not.

#### M2 — Vehicle identity

| Column | Type | Notes |
|---|---|---|
| `trips.vehicle_key_hash` | `String(32)`, NULL | Populated from §3.1 |

Index: `ix_trips_user_vehicle_key` — btree on `(user_id, vehicle_key_hash)`, partial
`WHERE vehicle_key_hash IS NOT NULL`. Serves the `VEHICLE_KEY_MIN_TRIPS` history count, which
is the only query this column has.

`users.bluetooth_device_id` and `users.bluetooth_device_name` MUST be dropped in this
migration. Nothing writes them, CAR-153 records the decision that nothing will, and leaving
two always-null columns adjacent to a live vehicle identity invites a future reader to use the
wrong one.

#### M3 — Co-travel candidate index

The matcher requires candidate pre-selection. `trips.route_waypoints` is `JSONB`; there is no
geometry type and no PostGIS extension in this stack, so no spatial index can be declared
against it as it stands.

**Two options. Option A is specified; Option B is recorded as the upgrade path.**

**Option A — scalar geohash, recommended.** No extension, no deployment change.

| Column | Type | Derivation |
|---|---|---|
| `trips.start_geohash` | `String(8)`, NULL | Geohash of the first waypoint, precision `COTRAVEL_CANDIDATE_GEOHASH_LEN` |
| `trips.end_geohash` | `String(8)`, NULL | Geohash of the last waypoint, same precision |

Index: `ix_trips_cotravel_candidates` — **btree** on
`(start_geohash, end_geohash, started_at)`, partial `WHERE start_geohash IS NOT NULL`.

Column order is load-bearing: the two geohashes are equality predicates and `started_at` is a
range predicate, so the range column MUST come last or the index degrades to a scan on the
time filter.

Both columns MUST be backfilled for existing rows in the same migration. A NULL geohash makes
a trip permanently unmatchable.

**Option B — PostGIS.** `LINESTRING(Geography)` column plus a **GiST** index, with
`ST_DWithin` for the radius test. Better selectivity, and required if the matcher ever needs
true trajectory operators. Rejected for now: it adds an extension to provision and verify on
the Azure Container App, and Option A's selectivity is sufficient at the trip volumes in
§7 Phase 2. Revisit only when candidate-set size is measured, not before.

#### M4 — Retention

A scheduled job deleting `trip_occupancy` rows older than `EVIDENCE_RETENTION_MONTHS`.
Requires index `ix_trip_occupancy_evaluated_at` — btree on `evaluated_at`.

---

## 4. Enforcement rules

### 4.1 Rung mapping

The ladder is defined in [fraud-detection.md](fraud-detection.md) §5 and is not restated. This
table maps occupancy evidence onto it.

| Evidence | Rung | Effect |
|---|---|---|
| Classifier verdict, no deterministic corroboration | 1 | Trip scores and pays. Prompt issued. |
| Co-travel pair, unresolved | 1 | Both trips pay. Both flagged. Recorded against both accounts. |
| Co-travel pair, resolved against this account by L1 | 2 | Reversal attempted per §4.3. |
| User answers "no" to a prompt | 2 | Reversal attempted per §4.3. |
| User declares unprompted | — | Reversal attempted per §4.3. **Not an enforcement action.** |
| Pattern across trips | 4 | Manual review. |

Normative:

1. A verdict with `source = CLASSIFIER` MUST NOT set `enforcement_rung > 1`.
2. No occupancy evidence MAY set `enforcement_rung = 3`.
3. Every rung ≥ 1 MUST produce a driver-visible message naming its appeal path.
4. An unprompted declaration MUST NOT create a flag, a review entry, or any account-level mark.
5. An unanswered prompt MUST NOT escalate on a timeout. Silence is neither answer.
6. Rung 4 MUST NOT be reached from a single trip.

### 4.2 Pair resolution

Applied in order. Resolution MUST stop at the first branch that matches.

1. Exactly one account has `binding = KNOWN_VEHICLE` → that account is the driver; the other
   trip is actioned at rung 2.
2. Neither or both have `KNOWN_VEHICLE` → both accounts are prompted. One "no" resolves the
   pair. Two "yes" answers leave `resolved_by = UNRESOLVED`; both trips pay, both are flagged,
   and the pair is recorded against both accounts.
3. A pair MUST NOT be resolved by comparing trip scores, account age, or history volume.

Resolution MUST NOT assume that either party drove. Both trips being passenger trips is a valid
outcome and MUST be representable.

### 4.3 Reversal

Points are credited synchronously inside `POST /api/trips`. A co-travel pair is only
discoverable after both trips are paid, and `users.points` is a fungible integer decremented at
redemption by the conditional `UPDATE` in `rewards.redeem()`. Reversal is therefore
best-effort.

Normative:

1. Point crediting at save time MUST NOT be delayed to accommodate this specification.
2. A reversal MUST be attempted only within `COTRAVEL_REVERSAL_WINDOW_H` of the trip's
   `created_at`.
3. A reversal MUST execute in full or not at all. Partial reversals MUST NOT be performed.
4. A reversal MUST NOT drive `users.points` below zero.
5. Where the balance does not cover the full amount, outcome MUST be `BALANCE_INSUFFICIENT`
   and the record MUST still be written.
6. A reversal MUST NOT touch a redeemed voucher or any `redemptions` row.
7. Every attempt MUST write a `ReversalRecord`, including attempts that reverse nothing.

**A first offence will normally not be recovered.** The control is pattern accumulation toward
rung 4, not restitution. A settlement delay would change this and is out of scope until the
pair rate and the `BALANCE_INSUFFICIENT` rate are measured.

### 4.4 Driver-score exclusion

Exclusion and reversal are independent and frequently disagree.

| State | In the driver score |
|---|---|
| Flagged at rung 1, unresolved | Included |
| Confirmed passenger trip — declared, answered, or resolved pair | Excluded |
| Reversal failed with `BALANCE_INSUFFICIENT` | **Excluded** |

Normative:

1. A trip with `excluded_from_driver_score = true` MUST be omitted from the rolling driver
   score defined in [scoring.md](scoring.md) §4.1, matching the fraud exclusion in §4.4 there.
2. Exclusion MUST apply forward only. Historical leaderboard standings MUST NOT be recomputed.
3. Exclusion MUST be applied independently of reversal outcome.

### 4.5 Operational requirements

| Requirement | |
|---|---|
| Kill switch | Occupancy enforcement MUST be disableable at runtime via `OCCUPANCY_ENFORCEMENT_ENABLED` without a deploy |
| Auto-suspend | Flagging MUST suspend automatically when `MAX_FLAG_RATE_PER_USER` is breached |
| Appeal SLA | An appeal MUST receive a human decision within `APPEAL_SLA_HOURS` |
| Queue ownership | No rung-2 path MAY ship before the review queue has a named owner and the SLA above is met |

The last row is a release gate, not a recommendation. Withholding money behind a review nobody
performs is a worse outcome than no detection.

---

## 5. Constraints and edge cases

### 5.1 Accepted losses

| Case | Reason | Mitigation |
|---|---|---|
| Single passenger, no second CARMA account, no binding | No deterministic corroborator exists | Rung 1 only |
| A user who shapes behaviour to defeat the classifier | Every signal in §2.3.3 is defeatable | Economic: daily and monthly caps |
| Accounts below `BASELINE_MIN_TRIPS` | F5 has no baseline | F5 emits `UNKNOWN` |
| First offence in most reversal cases | §4.3 | Pattern accumulation to rung 4 |

### 5.2 Honest cases that MUST NOT be penalised

| Case | Signal that fires | Required handling |
|---|---|---|
| Mid-journey driver swap | F2 conflicting per-window verdicts | Verdict MUST be `UNKNOWN` (§2.3.3.4) |
| Convoy — separate cars, same route and time | L2 conditions 1–5 | Condition 6 (stop alignment) MUST reject |
| Couple who genuinely alternate driving | Pairs on every shared trip | Correct behaviour. A high pair rate alone MUST NOT reach rung 4 |
| One person, two devices | L2 self-pair | Condition 1 MUST reject |
| Motorcycle or scooter rider | No family matches the kinematics | `UNKNOWN`. Outside the score's valid input range ([scoring.md](scoring.md) §1) |
| Driving instructor and learner | Two plausible drivers | Unresolvable. Pair is permitted to remain `UNRESOLVED` |
| Taxi or rideshare passenger | Chauffeured pattern at 100% | Voluntary declaration (§3.3), never detection |

### 5.3 Failure modes

| Failure | Required behaviour | Principle |
|---|---|---|
| Evaluator offline or backlogged | Trips score, pay, remain unflagged | P1 |
| Waypoint trace absent or too sparse | No pair opened. A pair MUST NOT be opened by default | P2 |
| Prompt issued and ignored | Trip remains at rung 1 indefinitely | §4.1.5 |
| Review queue unstaffed | Rung-2 path MUST NOT be enabled | §4.5 |
| Calibration regression | Flagging auto-suspends on `MAX_FLAG_RATE_PER_USER` | §4.5 |
| Play Services / sensor unavailable | Affected signal is `None`, never `False` | P2 |

### 5.4 Known specification gaps

| Gap | Status |
|---|---|
| `COTRAVEL_STOP_ALIGNMENT_MIN` has no empirical basis | Blocked on Phase 2 telemetry |
| Convoy false-pair rate is unmeasured | `MAX_FALSE_PAIR_RATE` is a target, not a validated figure |
| L2 catch rate scales with user density and is near zero at launch | Accepted; L2 is built for the evidence shape |
| Settlement delay as an alternative to §4.3 | Deferred pending measurement |

---

## 6. Configuration

All values are server-delivered configuration under [fraud-detection.md](fraud-detection.md) P5
and MUST be reported as `calibration_version` on every record.

**Basis** — `unfitted`: chosen from expectation, not CARMA data. `derived`: follows from another
specified value. `platform`: imposed by an external system. `economic`: a business ceiling.

| Key | Type | Value | Basis |
|---|---|---|---|
| `OCCUPANCY_ENFORCEMENT_ENABLED` | `bool` | `false` | flag |
| `VEHICLE_KEY_SALT` | `str` (secret) | — | Azure Key Vault; not in config |
| `VEHICLE_KEY_MIN_TRIPS` | `int` | `3` | unfitted |
| `COTRAVEL_TIME_TOLERANCE_S` | `int` | `120` | unfitted |
| `COTRAVEL_DISTANCE_TOLERANCE` | `float` | `0.15` | unfitted |
| `COTRAVEL_TRACE_OVERLAP_MIN` | `float` | `0.80` | unfitted |
| `COTRAVEL_WAYPOINT_RADIUS_M` | `int` | `150` | platform — consumer GPS error envelope |
| `COTRAVEL_STOP_SPEED_KMH` | `float` | `10.0` | derived — matches `SPEED_THRESHOLD_KMH` |
| `COTRAVEL_STOP_TIME_TOLERANCE_S` | `int` | `15` | unfitted |
| `COTRAVEL_STOP_ALIGNMENT_MIN` | `float` | `0.70` | unfitted |
| `COTRAVEL_CANDIDATE_GEOHASH_LEN` | `int` | `5` | derived — ≈ 5 km cell |
| `COTRAVEL_REVERSAL_WINDOW_H` | `int` | `72` | unfitted — MUST exceed the sync queue's worst case |
| `OCCUPANCY_WINDOW_S` | `int` | `30` | derived — Appendix B.2 |
| `OCCUPANCY_SEGMENT_S` | `int` | `240` | derived — Appendix B.2 |
| `MIN_TURNS_FOR_LATERAL` | `int` | `6` | unfitted |
| `BASELINE_MIN_TRIPS` | `int` | `20` | unfitted |
| `MIN_OCCUPANCY_SPECIFICITY` | `float` | `0.85` | unfitted — Appendix C.1 |
| `MAX_FALSE_PAIR_RATE` | `float` | `0.01` | unfitted |
| `MAX_FLAG_RATE_PER_USER` | `float` | `0.10` | unfitted |
| `MIN_LABELLED_PASSENGER_TRIPS` | `int` | `200` | derived — Appendix C.2 |
| `APPEAL_SLA_HOURS` | `int` | `72` | economic |
| `EVIDENCE_RETENTION_MONTHS` | `int` | `12` | inherited — `fraud-detection.md` P6 |

No figure in §1.4 MAY be published from a sample smaller than `MIN_LABELLED_PASSENGER_TRIPS`.

---

## 7. Delivery phases

Dependency-ordered. Each phase is blocked by the one above it.

| Phase | Deliverable | Depends on | Surface |
|---|---|---|---|
| **1** | Label channel: post-trip prompt + permanent "I was a passenger" control (§3.3) | — | `mobile/` |
| **2** | Vehicle identity: `vehicle_key_hash`, M1–M4 migrations, index (§3.4) | 1 | `server/`, `mobile/`, `alembic/` |
| **3** | Co-travel matcher + reversal (§2.3.2, §4.3) | 2 | `server/` |
| **4** | Per-user baseline, F5 (§2.3.3) | 3 | `server/` |
| **5** | Supervised classifier, F1–F4 (§2.3.3) | 4, CAR-164 for F1 | `server/`, `mobile/` |
| **6** | Vehicle-resident BLE hardware | Not planned | — |

Phase 1 delivers standalone value and MUST NOT be sequenced behind detection work: it is the
only control that gives an honest chauffeured user a way to stop earning points they did not
earn, and it is the sole source of labelled data for phases 4 and 5.

Phase 6 is recorded for completeness. It is justified by a fleet or insurance product and MUST
NOT be scoped against the consumer application.

---

## 8. Conformance

Assertable invariants. Each maps to a normative requirement above.

**Enforcement**

1. `source = CLASSIFIER` never yields `enforcement_rung > 1`.
2. `enforcement_rung` is never 3, enforced at both the schema and the database constraint.
3. Every record with `enforcement_rung >= 1` has an associated driver-visible message.
4. An unprompted declaration produces no flag, no review entry, no account mark.
5. An unanswered prompt never escalates.
6. Rung 4 is never reached from a single trip.

**Points and score**

7. No reversal drives `users.points` below zero.
8. No reversal executes partially; `ReversalRecord` rejects it at construction.
9. Exclusion is applied independently of reversal outcome.
10. Every reversal attempt writes a record, including no-op attempts.
11. No historical leaderboard standing is recomputed.

**Detection**

12. Pairs are opened only between distinct `user_id`s.
13. Both overlap directions are computed and stored.
14. Stop alignment is evaluated on every candidate pair.
15. Conflicting per-window verdicts resolve to `UNKNOWN`.
16. Every behavioural signal consumes vehicle-frame quantities.
17. No signal reads engine vibration or engine-generated EMF.
18. Occupancy evaluation never blocks or fails a `POST /api/trips` response.
19. A missing sensor or trace yields `None`, never `False`.

**Measurement**

20. Specificity is reported per user, never as a fleet mean, never as accuracy.
21. No §1.4 figure is published below `MIN_LABELLED_PASSENGER_TRIPS`.
22. Every label records its provenance; no validation set reports a quality stronger than its
    weakest provenance.

**Privacy**

23. `OccupancyOut` never exposes `paired_user_id`, `likelihood`, `signals`, or thresholds.
24. No raw MAC address is transmitted, logged, or stored.
25. No raw sensor trace leaves the device for occupancy purposes.
26. Records older than `EVIDENCE_RETENTION_MONTHS` are deleted by a scheduled job.

---
---

# Appendices — non-normative

*The following contain no requirements. They record why the rules above are what they are, and
what they were measured against.*

## Appendix A — Threat model

Extends [fraud-detection.md](fraud-detection.md) §1.

| Actor | Capability | Target |
|---|---|---|
| **Passenger** | None. Leaves the app running while another person drives. | Occupancy — the volume case |
| **Couple** | Two CARMA accounts in one vehicle, both recording. | Occupancy at double cost |
| **Chauffeured** | Always a passenger: taxi, rideshare, a partner who always drives. | Occupancy at 100% of trips |
| **Coacher** | Understands the detector and shapes behaviour against it. | Any behavioural classifier |

**Economic exposure.** At roughly ₪0.10 per point against a 3,000-point monthly cap
([scoring.md](scoring.md) §4.4), a user who successfully claims another person's trips earns
up to ₪300 a month without driving.

**Why our error costs differ from the industry's.** In usage-based insurance, misattribution
is a fairness problem and both parties want it corrected; a policyholder disputes trips that
were not theirs. In CARMA every trip pays, so no user ever disputes a misattribution in their
favour. Two consequences: self-correction never arrives, and specificity rather than accuracy
is the only meaningful metric. A threshold lifted from an insurer's tuning is calibrated
against the wrong loss function.

## Appendix B — Industry benchmarks

Published figures. Not CARMA results.

### B.1 Cambridge Mobile Telematics

The reference implementation, and the only vendor with independent third-party validation.

| Metric | Figure | Source |
|---|---|---|
| Driver vs. non-driver accuracy | 96.5% (SD 5.1) | Ebert et al. 2024 |
| Sensitivity | 97.5% (SD 4.6) | Same |
| **Specificity** | **91.2% (SD 14.8)** | Same |
| Company-stated classification accuracy | 97% | CMT, citing the same study |
| DriveWell Tag | 2″×2″ BLE, peel-and-stick, 4-year battery, records with or without the phone present | CMT |

- **Solved from phone sensors alone.** The validated classifier used no dongle and no beacon.
  Driver identification is a modelling problem, not a hardware problem — the basis for
  deferring Phase 6.
- **Specificity is the weak figure.** The study's participants averaged 120.9 driver trips
  against 26.5 non-driver, so roughly four in five trips were the easy class. Even at the
  industry's best, about one passenger trip in eleven is scored as driving.
- **SD 14.8 is a design constraint.** A control varying that widely works well for most users
  and badly for a systematic minority — those whose phone placement, vehicle, or habits sit
  outside the common case. Hence per-user measurement in §1.4.
- **Ground truth was self-report**, collected by weekly in-app survey. Participants can only
  report errors they noticed, so 96.5% is an optimistic ceiling.
- **The architectural split, in CMT's words:** *"While the app identifies the driver, the Tag
  identifies the vehicle."* §1.2 is that sentence applied to CARMA.

### B.2 Sentiance

The most detailed public description of a production occupancy classifier.

| Approach | Figure |
|---|---|
| Per-user anomaly detection (Isolation Forest) | AUC 0.94; passenger-class precision 0.73, recall 0.76; 0.91 overall |
| Global mixture model | AUC 0.88; Matthews correlation 0.66 |
| Supervised architecture | CNN–LSTM, ~2M parameters, 30 s windows within 4-minute segments |
| Inputs | Longitudinal acceleration, lateral acceleration, yaw rate |

Two findings carried into this specification: **personalisation beats a larger global model**
(the basis for sequencing F5 ahead of F1–F4), and **label noise, not model capacity, is the
limiting factor** (the basis for Phase 1). The window and segment values in §6 come from this
architecture.

Passenger-class precision of 0.73 means roughly a quarter of the trips their best method calls
"passenger" are not. That figure, not the AUC, is why §4.1.1 exists.

### B.3 Academic methods and their boundaries

| Method | Reported | Boundary |
|---|---|---|
| Vehicle-entry detection (ADDICT) | 90–93% TPR, 91–93% TNR | **Petrol, front-engine only** — uses engine vibration and EMF |
| Entry-direction / door side | 87–95% TPR, 84–90% TNR | Requires sensing before trip start |
| Overall driver detection (ADDICT) | 86.6–96.6% driver, 80.0–96.6% passenger | Same engine-type boundary |
| Seat side from turn asymmetry (TEXIVE) | >90% sensitivity at a 4–4.5 s window | Requires turns in both directions |
| Right-leg motion | Published, no independent replication located | Pocketed phones only |

### B.4 Market position

DriveQuant, Damoov, Arity, and IMS publish no driver/passenger accuracy figure. The literature
names the category a *Driver Detection System* and frames it as our §2.3.3 does: assign the
phone to a cabin quadrant from manoeuvre signals.

The multi-driver household remains unsolved industry-wide. Insurers fall back on collective
risk assessment, manual driver tagging, or crediting whichever enrolled phone is detected —
which is why §1.2 treats attribution as data model only.

## Appendix C — Rationale for selected rules

### C.1 Why accuracy is banned as a metric, and why the specificity target is below the industry's

Accuracy on an imbalanced class mix measures the majority class. With four in five trips being
driver trips, a detector that answers "driver" unconditionally scores 80%. Specificity measures
what this system exists to catch.

`MIN_OCCUPANCY_SPECIFICITY` is set at 0.85, below CMT's published 91.2%, because that figure
rests on participant self-report and ours will too (Appendix B.1). Matching it on paper would
mean matching an optimistic ceiling with a number of equal or worse provenance.

### C.2 Why `MIN_LABELLED_PASSENGER_TRIPS` gates every published figure

Specificity is estimated on the minority class, so the governing sample size is the count of
labelled *passenger* trips, not of trips. At 50 labelled passenger trips, a point estimate of
0.85 carries a 95% interval of roughly ±0.10 — wide enough to contain both "shippable" and
"broken." A dataset of 10,000 trips containing 40 passenger labels cannot evaluate this system,
and a confident percentage computed from it will be quoted in a deck.

### C.3 Why a probabilistic verdict never takes points

Occupancy is inferred, never measured, and every published method emits a likelihood. At fleet
volume a well-calibrated 0.95 is not an abstraction — it is a steady stream of real drivers
losing real money on drives they legitimately made. The rule's cost is that §2.3.3 can never
act alone, which is why §2.3.1 and §2.3.2 exist: to supply deterministic corroboration rather
than to make the classifier confident enough to act by itself.

This is the rule most likely to be relaxed by someone who does not know why it is there.

### C.4 Why engine vibration and EMF are prohibited

The strongest published entry-detection method keys on engine vibration and engine-generated
electromagnetic interference, and states its own boundary: petrol vehicles with front-mounted
engines. An electric vehicle produces neither signal. A detector built on them degrades
silently as the fleet electrifies, and degrades *toward accepting* — the population least
likely to be flagged would be the one growing fastest.

### C.5 Why the label channel is a permanent control, not a prompt

A user who is routinely driven should not need a detector to fire before they can say so. A
voluntary declaration is honest signal — nobody gives away points they could keep — and it is
the only control here that works on day one with no model, no pairs, and no labels. It carries
no adverse consequence by design (§4.1.4): marking an account for volunteering teaches everyone
to stay quiet.

## Appendix D — References

**Cambridge Mobile Telematics**
- [The DriveWell platform](https://www.cmtelematics.com/safe-driving-technology/how-it-works/)
- [DriveWell Tag](https://www.cmtelematics.com/drivewell-tag/)
- [CMT product announcement](https://www.cmtelematics.com/news/cambridge-mobile-telematics-announces-enhanced-driver-experiences-crash-capabilities-and-developer-tools/)

**Independent validation**
- Ebert, Xiong, Patel, Abdel-Rahman, McDonald, Delgado — [Validation of a smartphone telematics algorithm for classifying driver trips](https://www.sciencedirect.com/science/article/pii/S2590198224000952), *Transportation Research Interdisciplinary Perspectives*, May 2024

**Vendor engineering**
- [Sentiance — deep learning on passenger and driver behaviour](https://sentiance.com/deep-learning-on-passenger-and-driver-behavior-analysis-using-sensor-data)

**Academic**
- [ADDICT — Accurate Driver Detection Exploiting Invariant Characteristics of Smartphone Sensors](https://www.mdpi.com/1424-8220/19/11/2643), *Sensors* 19(11):2643
- [TEXIVE: Detecting Drivers Using Personal Smart Phones by Leveraging Inertial Sensors](https://arxiv.org/abs/1307.1756)
- [Detecting drivers through right leg motion](https://www.sciencedirect.com/science/article/abs/pii/S0045790623004172)

**Internal**
- [fraud-detection.md](fraud-detection.md) — P1–P6, the enforcement ladder, transport-mode classification. Authoritative where this document conflicts.
- [scoring.md](scoring.md) — the driver score, the points economy, and the driver/passenger gap as a known limitation.
