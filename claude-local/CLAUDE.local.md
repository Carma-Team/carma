# May — Personal Context (not shared, not committed)

Read this at the start of every new conversation on this project, before acting on any request.

## Precedence

This file always wins over the root `CLAUDE.md` (or any other project-level `CLAUDE.md`) when the two conflict on how Claude should behave — instructions, decisions, workflow rules I've set here. Team members may edit the project `CLAUDE.md` at any time; that never overrides a rule I've defined for myself in this file. Don't change the project `CLAUDE.md` to "fix" such a conflict — just follow this file and leave theirs alone. This is about behavioral rules, not factual project/team content: for objective facts (team roles, directory ownership, etc.) root `CLAUDE.md` remains the source of truth per "Role" below, unless I've explicitly overridden a specific fact here too.

## Role

May, Mobile & Frontend UI Lead, CARMA.
Ownership: mobile app screens and UI components (`mobile/src/screens/`, `mobile/src/components/`); the Driving SDK (`mobile/src/lib/driving-sdk/`) — GPS/IMU/BLE sensor integration; battery consumption management; client-side interactions.

Authoritative source for team roles/boundaries: root `CLAUDE.md` ("Core Team Roles"), `mobile/STRUCTURE.md`. Re-check these each session rather than trusting this summary if anything seems inconsistent.

## Working preferences

- I run all git/gh commands myself. Give me exact commands to copy — never execute `git commit`/`git push`/`gh pr create`/`gh issue close` or any other state-changing command. Read-only checks (`git status`, `git log`, `git branch --show-current`, `git diff`) are fine to run directly.
- I never perform a merge myself, of any kind — not `git merge`, not clicking "Merge" on GitHub, not `gh pr merge`, even on my own PR once it looks approved. My workflow is: open the PR, add the appropriate review comment, and ask others (in particular whoever opened the underlying issue, as long as it isn't me) to review and approve/execute the merge. Never suggest or run a merge-executing command on my behalf.
- Before touching a branch: check `git status`, `git branch --show-current`, `git stash list` first.
- PowerShell + multi-line `gh ... --body`: wrap in quotes (`--body "$var"`) or use `--body-file -` via stdin. Full detail: `.claude/skills/github-workflow`.
- Don't run test suites (Jest, etc.) without asking first. Never run `tsc --noEmit` or any other compilation/type check myself, ever — I run all compilation checks myself (VS Code or my own terminal). Just tell me when a check is worth running and what command to use; don't run it for me and don't ask permission to run it either, the answer is always no.

## Issue tracking

`claude-local/` holds the state (this file is process/preferences only — don't duplicate issue/PR-specific data here):
- `ISSUES.local.md` — **active work only**: issues already started (in progress / changes requested), plus anything needing coordination before it can start. Read at the start of any session involving issue work.
- `ISSUES_BACKLOG.md` — frozen snapshot of not-yet-started issues, by priority. When starting one, move its row into `ISSUES.local.md` rather than copying it. Only refreshed on an explicit rescan request, not automatically.
- `ISSUES_TO_OPEN.md` — issues identified but not yet created in Linear, with who they should be assigned to and a ready-to-post comment.
- `QUESTIONS_TO_RAISE.md` — questions needing a joint team decision (not work to do or an issue to file) — a choice between options that can't be made unilaterally.

Each file has its own scan/update/comment-writing rules — read those rather than assuming.

## Session workflow

- One conversation = one issue, or a small cluster of issues that are really sub-problems of one underlying fix (same code area, one coherent change) — don't mix unrelated issues in one session.
- Exception to the above: meta-changes to `.gitignore`/`CLAUDE.local.md` itself (this file is personal, gitignored, not shared) can always ride along with whatever issue branch/commit is active in the session — no need to flag or split these out separately each time.
- Session start: verify local repo is current — `git fetch origin`; check if the working branch needs `git merge origin/develop` before proceeding.
- Session end: update `ISSUES.local.md` (status, PR #, any new "עדכונים ושינויים נדרשים" rows) for whatever was touched this session — that's the continuity mechanism now, not a bespoke next-session prompt. Only write a next-session prompt if I ask for one, or if there's session-specific nuance the tracker's columns can't capture.
- Before every commit: state whether to open a new PR or push to an existing open one, and give the PR number either way.
- Once a PR is opened in a session, rename the conversation title to `PR X` (X = that PR's number) — so I can find the session again later to continue work on it or look up decisions made during it. If a session later moves on to a different PR, rename again to match. Don't rename for sessions not centered on a specific PR (e.g. planning/triage-only sessions like this one).
- All pushes go to `develop`. Never `main` — see "Team process" below.
- If a PR is already open and further changes are made afterward (new files, edits, added tests), verify (`git status`) that they're actually committed and pushed to that PR's branch *before* describing them as done anywhere on GitHub (PR body, issue comment). Never let a GitHub-facing claim describe a change that's still only local.

## בעיה חדשה שמתגלה תוך כדי עבודה

- לא בתחום האחריות שלי → לפתוח ISSUE מתאים ולהקצות את חבר הצוות שבמסגרת תפקידו צריך לטפל בה (לפי טבלת התפקידים / role-ownership-lookup).
- בתחום האחריות שלי:
  - נובעת מהטיפול בבעיה הנוכחית בשיחה, ניתן לטפל בה באותה שיחה, וקשורה לאותם קבצי קוד/עדכונים → לטפל בה עכשיו.
  - קשורה ל-issue אחר קיים, או שהטיפול בה עלול להיות ארוך מדי לניהול באותה שיחה, ואין קשר ממשי בין הבעיה שאנחנו פותרות לבין זו שהתגלתה → להעלות בפניי, ולהחליט יחד: לפתוח ISSUE (לפי חומרה) או לטפל בשיחה הבאה.
- בכל מקרה — לתעד ב-`ISSUES.local.md`, בטבלת "עדכונים ושינויים נדרשים", לא כאן.

## Issue priority order

1. Anything the issue's opener explicitly marked/labeled as urgent — check this first, before the ordering below.
2. **Within the same priority tier, resume before starting new**: an issue already active in `ISSUES.local.md` with a concrete next action waiting on me (e.g. a row in "עדכונים ושינויים נדרשים", or a review comment I still need to address) comes before picking up a fresh issue from `ISSUES_BACKLOG.md` at the same tier. Don't leave in-progress work idle to start something new of equal priority.
3. Otherwise, when picking new work: driving-sdk / SDK (sensor detection, GPS, Bluetooth, permissions) before UI.
4. Within UI: broken logic/functionality (a button or event that doesn't work) before pure visual/cosmetic issues (appearance only, no functional impact).

## driving-sdk — architecture rules

Living section — update when I sharpen these rules further.

- `driving-sdk/` is a generic, standalone library for mobile-device integration (GPS/IMU/BLE). Not CARMA-specific. Must be usable by any developer building any driving-monitoring app.
- Every CARMA action requiring device integration goes through a `driving-sdk/` operation. Never access the device directly from CARMA-specific code.
- Missing operation: (1) add the generic implementation to `driving-sdk/`, no CARMA business logic inside it; (2) wrap it in a CARMA-specific file under `mobile/src/lib/` (outside `driving-sdk/`) that adapts it to CARMA's actual need.
- Scoring algorithm (Dan's domain) is not part of `driving-sdk/`. If it needs a device measurement, `driving-sdk/` supplies it as a generic capability — the SDK itself has no awareness that CARMA uses the value for scoring. That link exists only in the CARMA-specific wrapper code.
- Test for any addition to `driving-sdk/`: would this make sense to a developer building an unrelated app, with zero knowledge of CARMA? If no, it belongs in `mobile/src/lib/`, not inside `driving-sdk/`.

## Team process

- `develop` → `main` merge: decided and executed only by whoever owns CI/CD. Never me unilaterally, never Claude on my behalf.
- Default branch is `main`, not `develop`. PRs into `develop` don't auto-close linked issues on merge. Close issues manually after the `develop` merge happens.
