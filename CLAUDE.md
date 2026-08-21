# CARMA — Monorepo Instructions

CARMA is a mobile platform that rates driving behavior in real time to improve road safety through gamification. An npm-workspaces monorepo: a React Native (Expo) client, a FastAPI + PostgreSQL server, and a local mock server for development.

**Guiding principle — keep it simple.** Build what is needed now, never for hypothetical requirements. Before adding a layer, a config flag, or a file, ask whether removing something solves it instead. Readable beats clever. Genuine complexity — sensor fusion, fraud detection, scoring — stays visible and well-named rather than hidden behind indirection. When in doubt, choose the simpler solution.

---

# Pillar 1 — Working with Claude

## Autonomy and its limits (active when the user is Dan)

Read both halves together. The authority above is bounded by the limits below.

- **Act, don't ask.** Read, write, modify files, and run git and deployment workflows without micro-confirmations. No abstract implementation plans unless the request is genuinely ambiguous.
- **Commit and merge local feature branches** once the local suite passes.
- **Finish the task.** Report when it is done, not when it is half done.

Limits — absolute:

- **Stop at the ownership line.** Never edit code owned by another team member (see roles below). Open a Linear ticket describing what needs to change, assign it to the owner, and stop there.
- **Never force-push to remote `main` or rewrite shared history** without Dan saying so in that session.
- **Text destined for GitHub or Linear is shown to Dan before it is posted** — every PR description, review, issue body, and comment. Code and merges are not.
- **Every Linear issue needs an assignee.** Never open one without an owner.

## Always check the industry standard

For any substantive question — a product decision, an architectural choice, a scoring threshold, a disagreement in a PR — search for how the telematics industry already solves it and present that alongside the recommendation, unprompted. Search for real; never rely on recall. Name the players (CMT, DriveKit/DriveQuant, Damoov, Zendrive, Sentiance, LETSTOP) with concrete numbers where they exist. If there is genuinely no standard, say so plainly instead of hedging. Then **build to that standard**, not merely report it. When the finding is useful to the team, it goes in the GitHub comment too, not only in chat.

## Communication style

Applies to chat and to everything drafted on Dan's behalf.

- **Lead with the conclusion**, then the reasoning. Never build up to the point.
- **Plain and at eye level.** A smart person who is not deep in this subsystem understands it on first read. Explain the impact, not the mechanism.
- **Short bullets over paragraphs.** No walls of text, no table where three bullets do the job.
- **300 words is the ceiling on GitHub.** Longer only when the length is load-bearing — a migration plan, a security finding needing reproduction steps. State the conclusion and the one fact behind it; Dan asks for the rest. Findings that change no decision go in a follow-up issue, not in the comment.
- **No decorative jargon.** Use a technical term only when it is the subject, and define it in half a sentence.
- **Hebrew or English per sentence — never both inside one sentence.** Mixing directions makes it unreadable.

## Keep the context small

Every tool call re-sends the whole conversation. Cached, so it is cheap per call — never free, and each call in a long thread costs more than the one before it. The cheapest work takes the fewest calls, not the fewest characters.

- **Batch the gates into one command**, not four round trips. Server — `ruff check . && ruff format --check . && mypy app && pytest -q`. Mobile — `npx tsc --noEmit && npm run lint && npm test -- --no-coverage`.
- **Never pipe a gate through `tail` inside a `&&` chain.** The pipe returns `tail`'s exit code, so a failing suite reads as a pass. Trim noisy output in a call of its own.
- **Never read a whole diff.** `gh pr diff <N> --name-only` first, then `gh pr diff <N> -- <path>` for the files that matter. A full diff runs 50 KB and then sits in context for the rest of the session.
- **Send broad searches to a subagent.** "Where is X handled?" goes to `Explore`, which answers without leaving six files behind in the main context.
- **Do not re-read a file already in context**, and drop the `cd` prefix — the working directory persists between calls.
- **One session per ticket.** `/clear` when the work lands, `/compact` only mid-task. Anything worth keeping belongs on the Linear issue or in the branch before you clear — never only in the thread.

## Roles and ownership

| Owner | Domain |
|---|---|
| **Dan — CPO** | Scoring formula and CARMA Score, roadmap priority, anti-fraud mechanics, application security (auth, rate limits, trip signing, abuse prevention) |
| **Naveh — CTO** | Database, cache, data pipelines, monorepo integrity, cloud infrastructure and deployment, CI gating, infrastructure security (secrets, network exposure, access) |
| **Shaun — CEO** | Business-logic API endpoints, third-party integrations |
| **May — Mobile & Frontend Lead** | Mobile screens, UI components and styling, Driving SDK (IMU/GPS/BLE), battery consumption, client-side interactions |

Inside `mobile/src/lib/` the line is drawn per file: each one opens with an `@owner` header naming
who decides what it does. **Before editing a file owned by someone else, say what you want to change
and get their agreement first.** The rule and the header format are in `mobile/CLAUDE.md`; the
current owner of every file is listed in `mobile/STRUCTURE.md`.

---

# Pillar 2 — Architecture & Engineering Rules

## Layout

```
carma/
├── mobile/     React Native (Expo) — npm workspace "carma-app". Has its own CLAUDE.md.
├── server/     FastAPI + PostgreSQL — Python, outside the npm workspaces.
├── docs/       How the system works today. Current only; retired specs live in git history.
├── scripts/    dev.ps1, setup.ps1, dev-tunnel.ps1, smoke.sh
└── .github/workflows/
```

## Commands

| Task | Run from | Command |
|---|---|---|
| Everything at once (Docker, Postgres, API on :3000, Metro, emulator) | root | `.\scripts\dev.ps1` |
| Install — mobile | root | `npm install` |
| Install — server | root | `pip install -r server/requirements-dev.txt` |
| Start mobile | `mobile/` | `npm start` |
| Start server | `server/` | `uvicorn app.main:app --reload --host 0.0.0.0 --port 3000` |
| Mobile — types / lint / tests | `mobile/` | `npx tsc --noEmit` · `npm run lint` · `npm test -- --no-coverage` |
| Server — types / lint / tests | `server/` | `mypy app` · `ruff check . && ruff format --check .` · `pytest` |
| Apply migrations | `server/` | `alembic upgrade head` |

## Definition of done

A change is done when every surface it touched passes locally. CI is the last line of defense, not the first.

| Touched | Must be green before you call it done |
|---|---|
| `mobile/**` | `npx tsc --noEmit`, `npm run lint`, `npm test -- --no-coverage` |
| `server/**` | `mypy app`, `ruff check .`, `pytest` |
| An API contract or DTO | Both rows above, plus `npm run gen:api` and the regenerated `generated.ts` committed |
| `develop` → `main` | `pytest` and `npx tsc --noEmit`, both green locally |

## Environment traps

Facts that cost hours and cannot be derived from the code.

- **Two Alembic heads after a branch switch fail ~78 unrelated tests.** The failures name missing columns, never migrations. Run `alembic upgrade head` before debugging any missing-column error, and confirm `alembic heads` returns exactly one.
- **The tests share the development database.** Fixtures left behind by another branch break tests that have nothing to do with your change.
- **PowerShell on Windows is the primary shell.** The server runs in a Python 3.12 venv on port 3000.

## API contract sync

The server's OpenAPI schema is the contract of record. `mobile/src/types/index.ts` is aliases over `mobile/src/services/api/generated.ts`, which is committed.

- **After any change under `server/app/schemas/`, run `cd mobile && npm run gen:api` and commit `generated.ts` in the same PR.** The generator needs a server running on :3000. Regenerating is a human step; what is automatic is that `tsc` then fails on every consequence of the change.
- **Never hand-edit `generated.ts`.** Hand-written members belong in `types/index.ts`, and only for what the schema cannot express: client-only fields, or a shape OpenAPI flattens to `string` or an opaque object. Comment which of the two it is.
- **`schema-drift` in `ci-mobile.yml` is what notices when you forget.** It regenerates from the app object and fails if the result differs from what is committed — no database, no running server. It replaced `contract-check`, which diffed the regenerated file against a baseline that gitignore guaranteed was absent and so could only fail. Do not send an author off to "just fix contract-check"; CAR-34 and CAR-105 were both filed for it and both closed as duplicates.
- **Generate against the pinned dependencies.** `fastapi` and `pydantic` versions decide how free-form objects are rendered, so a venv behind `server/requirements.txt` produces a file that CI rejects. `pip install -r server/requirements-dev.txt` first.

## `mobile/src/lib/driving-sdk/` — hard boundary

A generic sensor wrapper (GPS, IMU, Bluetooth) that will be extracted as a standalone npm package. It holds hardware abstraction only: `BluetoothManager`, `SensorManager`, `PhoneUsageManager`, `DrivingSDK` (`index.ts`), `types.ts`.

**Never add CARMA logic there** — trip validation, fraud thresholds, gamification levels, scoring formulas, business constants. Those consume SDK events from `mobile/src/lib/` directly: `FraudDetector.ts`, `TripValidationManager.ts`, `gamification.ts`.

Full layer rules live in `mobile/STRUCTURE.md`. Read it before adding or moving any file under `mobile/src/`.

---

# Pillar 3 — Workflow & Standards

## Branches

- **`main`** — deployable. Merged from `develop` at deliberate milestones only (demo, cloud deploy, sprint end). Never commit directly.
- **`develop`** — daily integration. Keep it green; it is the buffer protecting `main`.
- **`feature/*`** — anything over ~30 minutes or touching more than 2 files. Merges into `develop` freely, no PR required.

**The author merges, not the reviewer.** Only the author knows what else is in flight — which branch lands first, what needs a sync, which sibling PR is waiting. `develop` is not protected, which is exactly why the convention is written down. `main` is: a PR, one approving review, and ten green checks, with no bypass for anyone, admins included.

- **Approve means "this is yours to land."** Not ready to merge is Request Changes, not Approve.
- **Never merge over a red check without naming the failure in the PR first.** Doing it silently teaches everyone that red is negotiable. On `main` this is no longer a matter of discipline: the merge is blocked.

## CI

| Workflow | Trigger | What it does |
|---|---|---|
| `ci-server.yml` | pushes to `main`/`develop` are path-filtered; **every** PR into either runs it | Ruff, Mypy, pytest. A push to `develop` runs pytest **without a database**; PRs and `main` get migrations plus the Postgres job. |
| `ci-mobile.yml` | same | `tsc --noEmit`, ESLint, Jest, and `schema-drift`, which regenerates the API types and fails if they differ from what is committed. |
| `ci-web.yml` | same | `tsc`, ESLint, Vitest, and a production `vite build`. |
| `deploy.yml` | push to `main`, or manual | Docker image → ACR → Azure Container App over OIDC. Silently skipped when `AZURE_CLIENT_ID` is unset, so CI stays green. |

- **Never switch a check off to quiet it — fix the cause.** `tsc --noEmit` was skipped on `develop` to work around a broken toolchain (CAR-8); the workaround outlived the bug, and the app went 100+ commits with no type check while CI stayed green.
- **Run `pytest` locally against the real database** before merging anything server-side; a direct push to `develop` will not.
- **A PR whose branch predates a trigger change shows zero checks.** Sync `develop` into it — nothing else fixes it.
- **Ten checks are required on `main`:** `server lint`, `server tests`, `server docker build`, `mobile typecheck`, `mobile tests`, `mobile schema drift`, `web typecheck`, `web lint`, `web tests`, `web build`. A job skipped by its own `if:` reports success and does not block; that is why `server smoke` and `server tests (no db)` are not on the list.
- **Do not put a `paths:` filter back on a `pull_request` trigger.** A workflow that a path filter skips never reports, and a required check that never reports pins the PR on "Expected - waiting for status to be reported" with no way forward. The whole run is about two minutes in parallel and Actions is free on a public repo, so an unrelated PR paying for it is the cheaper side of the trade (CAR-122).
- **Job `name:` values are the required-check contexts.** They are the bare job name with no workflow prefix, so they must stay unique across all three workflows. Renaming one without updating the `main-branch` ruleset silently drops that gate.
- **Merged branches delete themselves.** `delete_branch_on_merge` is on (CAR-215); GitHub keeps a Restore branch button on every merged PR if you need one back.

## Issues — Linear only

- Every issue lives in Linear and is referred to by its `CAR-` number. **Never open a GitHub issue.**
- The reason: the Linear↔GitHub sync creates in one direction only. Opening in GitHub silently mints a Linear twin with a different number (`#83` is `CAR-49`); opening in Linear creates nothing in GitHub. That asymmetry is the whole problem and the whole fix.
- **Never bulk-close the old GitHub issues.** Status syncs both ways, so closing them marks their Linear twins Done and wipes the board. The 42 existing pairs age out naturally.
- **GitHub Issues stays enabled deliberately.** Disabling it breaks the ~150 `#NN` references in this codebase and 83 more in commit messages, which git history cannot repair.
- **Search Linear before opening anything.** `contract-check` was filed three times in five days, all by us.
- Put the `CAR-` id in the branch name or PR title (`ofridan/car-39-...`). Linear advances the issue on its own.

## Where writing goes

| Where | What it holds |
|---|---|
| `docs/*.md` | The specification — either how the system works today, or the target it is being built to. |
| A Linear document | Why we decided it. |
| A Linear issue | Work to be done, with an owner and a priority. |

**Every document declares which it is on the first line** — `Current behaviour.` or `Target architecture.` — before the first heading.

**A target document is written entirely in the target.** No status columns, no "not yet", no ticket ids, no list of what is missing. The distance between the target and today is work, and work lives in issues.

**A current-behaviour document is updated in the change that alters the behaviour**, not afterwards.

A task list is never a file — it has no owner, no priority, and nobody opens it. Never put a version number in a filename. Deleting a stale document is correct; git keeps it. Details in `.claude/rules/writing-docs.md`.

## Comments in code

Write why, not what. A comment earns its place only when it explains a choice the code cannot show. The reasoning belongs in the commit message — git history is permanent and cannot drift, while a comment sits next to code that moves. Details in `.claude/rules/code-comments.md`.
