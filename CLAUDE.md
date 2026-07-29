# CARMA - Unified Monorepo Configuration

## Project Context

CARMA is a mobile platform that monitors and rates driving behavior in real-time to improve road safety via gamification.

This repository is a clean npm-workspaces Monorepo containing the React Native mobile client, the FastAPI backend server, and a local mock server for development.

## Core Team Roles

- **Dan (CTO & CPO):** Core AI/ML scoring formula, CARMA Score algorithm, development roadmap prioritization, and anti-fraud mechanics.
- **Naveh (Chief Architect & Data Engineer):** Database architecture, cache layers, data pipelines, and Monorepo structure integrity.
- **Shaun (CEO & Backend Developer):** Business logic API endpoints, cloud infrastructure (Azure), and third-party integrations.
- **May (Mobile & Frontend UI Lead):** Mobile application screens, UI components and styling, **Driving SDK — IMU/GPS/BLE sensor integration**, battery consumption management, and client-side interactions.

---

## Design Philosophy — Keep It Simple

The guiding principle across all of CARMA's development is **simplicity**. This is not a constraint — it is a competitive advantage. Every technical decision should be weighed against it.

In practice this means:

- **Build what is needed now.** No abstractions for hypothetical future requirements. Three similar lines of code are better than a premature helper.
- **Solve the real problem.** Before adding a layer, a config flag, or a new file — ask whether removing something solves it instead.
- **Readable beats clever.** Code is read far more than it is written. Optimise for the next person reading it (often you, six months from now).
- **Small, complete units of work.** A feature that ships is worth more than a perfect architecture that doesn't. Scope ruthlessly.
- **Visible complexity is honest.** If something is genuinely complex (sensor fusion, fraud detection, scoring formulas), let it be visible and well-named — not hidden behind indirection.

When in doubt: choose the simpler solution.

---

## Repository Layout

```
carma/
├── mobile/                  ← React Native (Expo) — workspace: "carma-app"
├── server/                  ← FastAPI + PostgreSQL — Python, outside npm workspaces
├── docs/                    ← Architecture & algorithm docs (docs/archive/ for retired specs)
├── scripts/                 ← dev.ps1, setup.ps1, dev-tunnel.ps1, smoke.sh
└── .github/workflows/       ← ci-server.yml, ci-mobile.yml, deploy.yml
```

---

## Workspace Layout & Commands

### Quick Start (Full Stack)

```
.\scripts\dev.ps1
```

Starts Docker, Postgres, FastAPI on :3000, Metro bundler, and Android emulator in parallel. Use this for day-to-day development. The individual commands below are for running each service in isolation.

### Mobile Client (React Native / Expo)

- **Path:** `./mobile`
- **Install:** `cd mobile && npm install`
- **Start:** `npm run mobile:start` (from root) or `npm start` (from `./mobile`)
- **Run Tests:** `cd mobile && npm test -- --no-coverage`
- **Lint:** `cd mobile && npm run lint`
- **TypeScript check:** `cd mobile && npx tsc --noEmit`

### Backend Server (FastAPI / PostgreSQL)

- **Path:** `./server`
- **Install:** `pip install -r server/requirements-dev.txt`
- **Run (dev):** `cd server && uvicorn app.main:app --reload`
- **DB Migrations:** `cd server && alembic upgrade head`
- **Lint:** `cd server && ruff check . && ruff format --check .`
- **Tests:** `cd server && pytest`

---

## CI/CD

`ci-server.yml` and `ci-mobile.yml` run on pushes to **`main` and `develop`**. `deploy.yml` runs on `main` only, or manually.

**One gap you need to know about:** `tsc --noEmit` is skipped on `develop` while the mobile toolchain is broken (CAR-8). It is only enforced on `main` — and nothing has merged to `main` since 21 June, so the mobile app has not been type-checked in over 100 commits. Restore the check as soon as CAR-8 lands.

| Workflow | What it does |
|---|---|
| `ci-server.yml` | Ruff lint, Mypy, DB migrations, pytest, smoke tests |
| `ci-mobile.yml` | TypeScript check, Jest, API contract drift check (regenerates types from live OpenAPI and diffs against `mobile/src/types/index.ts`) |
| `deploy.yml` | Builds Docker image → pushes to ACR → deploys to Azure Container App. Has a built-in secrets gate: if `AZURE_CREDENTIALS` is not configured in GitHub Secrets the deploy step is silently skipped — CI stays green. |

**Before merging `develop` → `main`:** run `pytest` and `npx tsc --noEmit` locally. CI is the last line of defense, not the first.

---

## Branching Strategy

- **`main`** — stable and deployable. Merged from `develop` only at deliberate milestones (demo, cloud deploy, sprint end). Never commit directly.
- **`develop`** — daily integration branch. All feature branches merge here. Tests must pass before merging.
- **`feature/*`** — short-lived branches for any change that takes more than ~30 minutes or touches more than 2 files. Merge freely into `develop` — no PR or review required.

The rule: `develop` is the buffer that protects `main`. Keep it green.

---

## Issue Tracking — Linear only

**Every issue lives in Linear. GitHub is for code.** Open a task in Linear, refer to it by its `CAR-` number, and never open one in GitHub Issues.

Why the rule exists: the two are connected by Linear's GitHub integration, and the connection is **one-way for creation**.

- Open it in **GitHub** → Linear silently creates a twin with a different number. `#83` is `CAR-49`; `#69` is `CAR-39`. Nothing maps one to the other, so the same work ends up discussed in two places under two names.
- Open it in **Linear** → nothing is created in GitHub. No twin, no confusion.

That asymmetry is the whole problem, and the whole fix.

**Do not bulk-close the old GitHub issues.** Status syncs both ways, so closing them there marks their Linear twins Done and wipes the board. The 42 pre-existing pairs stay open on both sides and age out naturally.

**GitHub Issues stays switched on, deliberately.** Turning the feature off hides the Issues tab, and with it the ~150 `#NN` references in this codebase, 83 more in commit messages, and 15 in PR descriptions — git history cannot be edited, so those break for good. The rule above already prevents new duplicates, because the sync only auto-creates in one direction.

**Linking a PR to its issue:** put the `CAR-` id in the branch name or the PR title (`ofridan/car-39-...`). Linear advances the issue on its own — no manual status updates.

---

## Where each kind of writing goes

Three places, three jobs. Putting something in the wrong one is how we ended up with a scoring spec that described three different formulas and a task list nobody had opened in six weeks.

| Where | What it holds | Example |
|---|---|---|
| **Markdown in `docs/`** | **How the system works today.** Always current. | `scoring.md` |
| **A Linear document** | **Why we decided it.** The reasoning behind a choice. | *How CARMA measures phone distraction* |
| **A Linear issue** | **Work to be done.** Has an owner and a priority. | CAR-54 |

**A task list is never a file.** It has no owner, no priority, and nobody opens it. That is exactly what happened to `scoring-v2-handoff.md`.

**Never put a version number in a filename.** `scoring-algorithm-v2.md` next to an archived `scoring-algorithm.md` told you nothing about which one was live, and `scoring_v2.py` was distinguishing itself from a `scoring.py` that had been deleted weeks earlier. The version belongs in a status header inside the file; the history belongs to git.

The one exception is a **decision record** — `RFC-001`, and any ADR we add. Those are numbered on purpose, because they are frozen in time. A decision record is never edited into currency; when it stops being true, a new one supersedes it.

**Deleting a stale document is correct.** Git keeps it (`git log --follow`, `git show <sha>:<path>`). A folder of retired documents duplicates version control and reads as current to anyone who does not check the date.

---

## Engineering Rules

1. **Shared Types:** Any change to API contracts or DTOs MUST be manually synchronized between `server/app/schemas/` and `mobile/src/types/index.ts`. Never let the two drift. The `gen:api` script in mobile (`openapi-typescript`) is available to automate this once the OpenAPI schema is stable — until then, sync manually. The CI (`ci-mobile.yml`) enforces this automatically on every merge to `main`.

### Mobile Directory Ownership

The `mobile/` workspace has a strict layer separation documented in **`mobile/STRUCTURE.md`**.
Read it before adding or moving any file under `mobile/src/`.

Critical boundary — `mobile/src/lib/driving-sdk/`:
- This is a **generic sensor-wrapper SDK** (GPS, IMU, Bluetooth). It will be extracted into a standalone npm package.
- It must contain **only** hardware-abstraction code: `BluetoothManager`, `SensorManager`, `PhoneUsageManager`, `DrivingSDK` (orchestrator, `index.ts`), and `types.ts`.
- **Never add** CARMA-specific logic here: trip validation rules, fraud detection thresholds, gamification levels, scoring formulas, or any business constants.
- CARMA-specific logic that consumes SDK events belongs in `mobile/src/lib/` (directly, not inside `driving-sdk/`): see `FraudDetector.ts`, `TripValidationManager.ts`, `gamification.ts`, `scoring.ts`.

## Working with Claude

### Dan's Developer Persona (Active when user is Dan)

1. **Full CTO Autonomy:** You hold complete executive authority to read, write, modify files, and execute deployment/git workflows autonomously.
2. **One-Shot Execution:** Do not halt tasks to request micro-confirmations or generate abstract implementation plans unless extreme ambiguity is present.
3. **Guardrails Action:** If local test suites pass successfully, you are authorized to auto-commit and merge local feature branches. Do NOT force-push directly to remote `main` if shared team history is modified without direct user input.
4. **Always check the industry standard.** For any substantive question — a product decision, an architectural choice, a scoring threshold, a disagreement over approach in a PR — search for how the telematics industry already solves it and present that alongside your recommendation. Do this unprompted. Search for real; do not rely on recall. Name the players (CMT, DriveKit/DriveQuant, Damoov, Zendrive, Sentiance, LETSTOP) and give concrete numbers where they exist. If there genuinely is no standard, say so plainly rather than hedging. When the finding is useful to the team, put it in the GitHub comment too — not only in chat.

### Communication Style (Dan's preference — applies to chat AND to anything drafted for GitHub)

Applies to replies in chat, and to every PR description, PR review, issue body, and issue comment written on Dan's behalf.

1. **Plain and at eye level.** Write so a smart person who is not deep in this subsystem understands it on first read. Explain the impact, not the mechanism.
2. **Concise, in short bullets.** Prefer a short list over a paragraph. No walls of text, no tables where three bullets do the job.
   - **GitHub length ceiling:** a PR description, review, or issue comment should fit on one screen — roughly 300 words. Longer only when the extra length is load-bearing (a migration plan, a security finding that needs reproduction steps).
   - Cut the reasoning that led you to the conclusion. State the conclusion and the one fact that supports it. Dan can ask for the rest.
   - Every finding does not need its own section. Findings that don't change a decision go in a follow-up issue, not in the comment.
3. **No needless jargon.** Only use a technical term when it is the actual subject — never as decoration. When a term is unavoidable, define it in half a sentence.
4. **Lead with what matters.** State the conclusion or the decision first, then the reasoning. Do not build up to the point.
5. **Language:** Hebrew or English per sentence — never both inside one sentence (RTL/LTR direction conflict makes it hard to read).

*Other team members can add their own persona section here.*

