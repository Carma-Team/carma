# CARMA — Academic Demo Sprint Execution Plan
**Sprint Window:** 2026-05-21 → 2026-06-04 (14 days)
**Demo Target:** Academic Presentation — Local Pipeline End-to-End
**Authored:** Dan Ofri (CTO) · 2026-05-21

---

> **Single objective:** Walk into the presentation with a live device talking to a local
> FastAPI server, points accumulating atomically, forged payloads rejected on-screen,
> and a UI polished enough that no professor notices we built this in a semester.

---

## Table of Contents

1. [Current Status Snapshot](#1-current-status-snapshot)
2. [Gamification Branch Risk — Resolution](#2-gamification-branch-risk--resolution)
3. [Repository Hygiene — Execution Commands](#3-repository-hygiene--execution-commands)
4. [14-Day Sprint Plan](#4-14-day-sprint-plan)
5. [P0 Task Tracker](#5-p0-task-tracker)
6. [Branch Strategy Going Forward](#6-branch-strategy-going-forward)
7. [Demo Green Checklist](#7-demo-green-checklist)

---

## 1. Current Status Snapshot

| Layer | Status | Notes |
|---|---|---|
| **Git Flow structure** | ✅ Active | `main` ← `develop` ← `feature/*` established |
| **NAVEH-P0-1** Atomic points UPDATE | ✅ Merged to `main` | Race condition eliminated |
| **NAVEH-P0-2** Migration 0004 | ✅ Merged to `main` | `telemetry_digest` + `payload_signature` columns ready |
| **SEAN-P0-1** Telemetry wiring | ✅ Merged to `main` | Fields flow through Pydantic → ORM |
| **SEAN-P0-2** Plausibility gate | ✅ Merged to `main` | 6-check physics filter, HTTP 422 on bad payload |
| **SEAN-P0-3** HMAC `ph:` bypass | ✅ Merged to `main` | `trip_signing_secret` in config, audit-logged |
| **MAI-P0-1** TypeScript errors | ✅ Merged to `main` | 22 errors → 0, CI gate restored, 125/125 tests |
| **DAN-P0-1** E2E integration | 🔲 Pending | Blocked on Sean + Naveh local server being up |
| **MAI-P0-2** Visual overhaul | 🔲 Pending | 5 screens to polish |
| `feat/gamification-progression-engine` | ⚠️ Stale | Analysis below — safe to delete |
| `origin/fix/mobile-lockfile` | ⚠️ Stale | Superseded — safe to delete |

---

## 2. Gamification Branch Risk — Resolution

### Finding

`feat/gamification-progression-engine` contains 2 unmerged commits that introduce
`mobile/src/lib/driving-sdk/utils/gamification.ts` — a file **inside the SDK boundary**.

Running the safety diff:

```bash
git diff main...feat/gamification-progression-engine \
  -- mobile/src/lib/driving-sdk/utils/gamification.ts
```

**Result:** The file in the branch is a **new file** (did not exist in `main` at that path).
The diff shows 86 lines — the exact same 10-level table, multipliers, `calculateLevel()`,
`getProgressPercentage()`, and `detectLevelUp()` that live in `main` today at the
**correct** location: `mobile/src/lib/gamification.ts`.

### What happened

The branch placed the gamification engine inside `driving-sdk/utils/` (wrong — SDK boundary
violation). A subsequent commit on `feat/gamification-engine` — which **is** merged to `main`
— performed `refactor(sdk): move FraudDetector, TripValidationManager, gamification out of driving-sdk`,
relocating the identical logic to `src/lib/gamification.ts`. No `driving-sdk/utils/` directory
exists in `main` at all.

### Verdict

| Check | Result |
|---|---|
| Logic unique to branch (not in `main`)? | ❌ No — identical content at correct path |
| Any file outside `driving-sdk/` with novel code? | ❌ No — `AppContext` changes superseded |
| Risk of losing a multiplier value or tier threshold? | ❌ Zero risk |
| SDK boundary violated if merged? | ✅ Yes — `driving-sdk/utils/` must not exist |

**Decision: safe to delete.** The branch is a historical artifact from before the SDK boundary
was enforced. All valid work reached `main` through the canonical `feat/gamification-engine` path.

### Manual verification sequence (run once before deleting)

```bash
# Step 1 — Confirm the current correct file in main is complete
cat mobile/src/lib/gamification.ts | grep "multiplier:"

# Expected: 10 lines, 1.00 through 1.50

# Step 2 — Confirm the branch file is byte-for-byte equivalent in logic
git diff main:mobile/src/lib/gamification.ts \
         feat/gamification-progression-engine:mobile/src/lib/driving-sdk/utils/gamification.ts

# Expected: only path/comment differences, no logic delta

# Step 3 — Confirm no driving-sdk/utils/ directory exists in main
ls mobile/src/lib/driving-sdk/

# Expected: index.ts  BluetoothManager.ts  types.ts  sensors/
# (no utils/ directory)

# Step 4 — Delete when satisfied
git branch -D feat/gamification-progression-engine
git push origin --delete feat/gamification-progression-engine 2>/dev/null || true
```

---

## 3. Repository Hygiene — Execution Commands

### 3.1 Category A Safe Purge — All Merged Branches

> All branches below return 0 results from `git log main..<branch> --oneline`.
> `git branch -d` (lowercase) refuses to delete unmerged branches — zero risk of accident.

```bash
# ── Local branches ────────────────────────────────────────────────────────────
git branch -d \
  chore/backend-quick-cleans \
  chore/monorepo-cleanup \
  chore/qa-hardening \
  feat/gamification-engine \
  feature/hybrid-validation-contract \
  feature/kinetic-phone-scoring \
  feature/mai-ui-type-alignment \
  fix/fraud-highway-false-positive \
  fix/frontend-p0-blockers \
  fix/process-end-trip-closure \
  fix/sdk-core-vulnerabilities

# ── Remote branches ───────────────────────────────────────────────────────────
git push origin --delete \
  chore/monorepo-cleanup \
  claude/document-folder-structure-xx8Tf \
  claude/move-legacy-package-lock \
  fix/mobile-lockfile

# ── After confirming gamification branch (Section 2 above) ───────────────────
git branch -D feat/gamification-progression-engine
git push origin --delete feat/gamification-progression-engine
```

### 3.2 Global Prune Configuration

```bash
# Prune dead remote-tracking refs on every fetch/pull — set once, lasts forever
git config --global fetch.prune true

# Verify
git config --global --get fetch.prune
# → true
```

### 3.3 GitHub Settings to Enable Now

Navigate to: **GitHub → Carma-Team/carma → Settings → General → Pull Requests**

| Setting | Required State |
|---|---|
| ✅ Automatically delete head branches | **Enable** |
| ✅ Allow squash merging | Enable (for clean history) |
| ✅ Allow merge commits | Enable (for `--no-ff` merges from `develop`) |
| ❌ Allow rebase merging | Disable (conflicts with `--no-ff` Git Flow) |

Once enabled, every merged PR deletes its head branch automatically. No manual cleanup needed going forward.

---

## 4. 14-Day Sprint Plan

> **Start:** 2026-05-21 · **Demo Day:** 2026-06-04
> All P0 backend tasks (Naveh + Sean) are **already committed to `main`**.
> The remaining critical path runs through DAN-P0-1 and MAI-P0-2.

```
DATE        MON 05/21  TUE 05/22  WED 05/23  THU 05/24  FRI 05/25  MON 05/28  TUE 05/29
            ─────────  ─────────  ─────────  ─────────  ─────────  ─────────  ─────────
NAVEH       ████DONE   ████DONE   ─────────  ─────────  ─────────  ─────────  ─────────
  P0-1 Atomic UPDATE   (committed)
  P0-2 Migration 0004  (committed)
  P1-1 levels.py mirror                      ░░░░░░░░░  ░░░░░░░░░

SEAN        ████DONE   ████DONE   ─────────  ─────────  ─────────  ─────────  ─────────
  P0-1/2/3 Validation gate (committed)
  P1-1 events INSERT                         ░░░░░░░░░  ░░░░░░░░░
  P1-2 Level recalc (blocked on Naveh P1-1)                         ░░░░░░░░░  ░░░░░░░░░

DAN         ░░░░░░░░░  ─────────  ░░░░░░░░░  ░░░░░░░░░  ████████   ████████   ████████
  Repo hygiene purge (today)
  P0-1 E2E integration                                   ░░░░░░░░░  ████████   ████████
  Local server IP config                                 ░░░░░░░░░

MAI                                                                  ░░░░░░░░░  ░░░░░░░░░
  P0-2 Visual overhaul (5 screens)

DATE        WED 05/28  THU 05/29  FRI 05/30  MON 06/01  TUE 06/02  WED 06/03  THU 06/04
            ─────────  ─────────  ─────────  ─────────  ─────────  ─────────  ─────────
DAN         ████████   ████████   ████████   ─────────  FREEZE     ─────────  🎓 DEMO
  E2E verification + DB query checks

MAI                    ░░░░░░░░░  ░░░░░░░░░  ████████   FREEZE     ─────────  🎓 DEMO
  P0-2 UI polish
  MAI-P0-1 tsc zero (done ✅)

NAVEH+SEAN                                   ░░░░░░░░░  FREEZE     ─────────  🎓 DEMO
  P1 tasks (level recalc, events table)

ALL TEAM               ─────────  ─────────  ─────────  ████████   ████████   🎓 DEMO
  Scenario dry-runs (3 demo scenarios)
  Performance audit
  Freeze — no new code after 06/02
```

**Legend:** `████` = done/active · `░░░░` = scheduled · `FREEZE` = code freeze

---

## 5. P0 Task Tracker

### 🟥 Naveh — Database Lead

| Task | ID | Status | Branch | Acceptance Criterion |
|---|---|---|---|---|
| Atomic points UPDATE | NAVEH-P0-1 | ✅ Done | merged to `main` | `UPDATE users SET points=points+delta` — no RMW |
| Migration 0004 | NAVEH-P0-2 | ✅ Done | merged to `main` | `alembic upgrade head` ↔ `downgrade -1` round-trip clean |
| `levels.py` mirror | NAVEH-P1-1 | 🔲 P1 | `feature/naveh-levels-mirror` | `points_to_level(950+60)` → level 2 |

### 🟦 Sean — Backend Lead

| Task | ID | Status | Branch | Acceptance Criterion |
|---|---|---|---|---|
| Telemetry wiring | SEAN-P0-1 | ✅ Done | merged to `main` | `SELECT telemetry_digest FROM trips` → NOT NULL |
| Plausibility gate | SEAN-P0-2 | ✅ Done | merged to `main` | `POST {points:99999}` → HTTP 422 |
| HMAC `ph:` bypass | SEAN-P0-3 | ✅ Done | merged to `main` | `ph:`-prefixed sig → 201 + audit log |
| Events bulk INSERT | SEAN-P1-1 | 🔲 P1 | `feature/sean-events-insert` | `SELECT COUNT(*) FROM events WHERE trip_id=X` → 1 |
| Level recalc | SEAN-P1-2 | 🔲 P1 | blocked on NAVEH-P1-1 | After 60-pt trip: `SELECT level FROM users` → 2 |

### 🟨 Dan — CTO / SDK / ML

| Task | ID | Status | Trigger | Acceptance Criterion |
|---|---|---|---|---|
| E2E integration test | DAN-P0-1 | 🔲 Active | After Sean + Naveh local server up | All 3 demo scenarios pass manually |
| Repo hygiene purge | — | 🔲 Today | Confirmed via Section 2 above | `git branch -a` shows only `main`, `develop` |
| `STAGING_SERVER_URL` config | DAN-P0-1 | ✅ Done | merged to `main` | `USE_REAL_SERVER=true` → points at local IP |

### 🟪 Mai — UI/UX Developer

| Task | ID | Status | Branch | Acceptance Criterion |
|---|---|---|---|---|
| TypeScript zero errors | MAI-P0-1 | ✅ Done | merged to `main` | `npx tsc --noEmit` → exit 0, 125/125 tests |
| Visual overhaul — 5 screens | MAI-P0-2 | 🔲 Active | `feature/mai-visual-overhaul` | Live walkthrough: polished, no placeholders |

---

## 6. Branch Strategy Going Forward

### Flow

```
main  ←──── develop  ←──── feature/<owner>-<task-slug>
              ↑                      │
              └──────────────────────┘
                     PR + code review
                     merge --no-ff
                     auto-delete head branch
```

### Naming Convention

| Prefix | Used for | Example |
|---|---|---|
| `feature/` | New functionality | `feature/sean-events-insert` |
| `fix/` | Bug fixes | `fix/dan-sync-race` |
| `chore/` | Non-functional work | `chore/naveh-db-indexes` |
| `hotfix/` | Urgent `main` patches | `hotfix/critical-auth-bypass` |

### Rules

1. **Never commit directly to `main` or `develop`.** All work via PR from a `feature/` branch.
2. **Branch off `develop`, not `main`.** `main` receives only merge commits from `develop`.
3. **One task per branch.** No "catch-all" branches with unrelated commits.
4. **Delete on merge.** GitHub auto-delete + local `git fetch --prune` keeps the repo clean.
5. **`npm test -- --no-coverage` must pass green before any PR is opened against `develop`.**

---

## 7. Demo Green Checklist

> Every item must be ✅ before the device leaves the room on 2026-06-04.

```
Infrastructure
  ✅ NAVEH-P0-1  — Concurrent test: 10 requests → final points = exact sum
  ✅ NAVEH-P0-2  — alembic upgrade head ↔ downgrade -1 round-trip clean
  ✅ SEAN-P0-1   — POST trip with telemetryDigest → DB column NOT NULL
  ✅ SEAN-P0-2   — POST { points: 99999 } → HTTP 422
  ✅ SEAN-P0-3   — ph:-prefixed signature → HTTP 201 + audit log entry
  ✅ MAI-P0-1    — npx tsc --noEmit exits clean, zero suppressions
  ☐  DAN-P0-1   — Full E2E: trip saved, points correct, telemetry stored
  ☐  MAI-P0-2   — 5 screens reviewed live on device, polished

Repository
  ☐  Stale branches purged (Category A + gamification confirmed)
  ☐  GitHub "auto-delete head branches" enabled
  ☐  git config --global fetch.prune true set on all dev machines

Demo Scenarios (must rehearse minimum twice)
  ☐  Scenario 1 — Normal car trip: score calculated, points saved, level shown
  ☐  Scenario 2 — Train ride detected: fraud blocked, fraud_reports row written
  ☐  Scenario 3 — Forged API request: { points: 99999 } → HTTP 422 on-screen

Baseline
  ✅ mobile/npm test -- --no-coverage → 125/125 PASS, zero regressions
```

---

*Document authored: 2026-05-21 · Dan Ofri (CTO)*
*All task IDs link back to `docs/Backend-Sync-Meeting-2026.md` and RFC-001.*
