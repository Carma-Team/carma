## Summary

<!-- 1–3 bullets. What does this PR do, and why? -->

## Affected area

- [ ] `server/` (Python backend)
- [ ] `mobile/` (Expo app)
- [ ] `mock-server/` (deprecated; usually skip)
- [ ] CI/CD, docs, scripts

## Contract change?

If this PR touches `server/app/routers/**` or `server/app/schemas/**`, or any request/response shape the mobile app consumes:

- [ ] Updated `CHANGELOG.md` (Added / Deprecated / Removed sections).
- [ ] For **breaking** changes: added the new shape first, marked the old one deprecated. Removal happens in a follow-up PR after one mobile release.
- [ ] Mobile types regenerated locally (`cd mobile && npm run gen:api`) and the app compiles.

## Test plan

- [ ] Local server boots (`./scripts/dev.ps1` or `uvicorn app.main:app --reload`).
- [ ] `scripts/smoke.sh` passes end-to-end.
- [ ] Manually exercised the affected flow in the Expo app, OR opted into full CI via the `run-full-ci` label.
