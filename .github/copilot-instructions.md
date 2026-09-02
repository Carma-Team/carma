# GitHub Copilot Instructions — CARMA Monorepo

## Repository layout

```
carma/
├── mobile/                   ← React Native / Expo (carma-app)
├── server/                   ← FastAPI + PostgreSQL
└── .github/workflows/        ← CI/CD
```

## Mobile app — directory ownership

Full details: **`mobile/STRUCTURE.md`**. Read it before creating or moving files under `mobile/src/`.

### Layer summary

| Directory | What goes here | What does NOT go here |
|---|---|---|
| `src/lib/driving-sdk/` | Generic sensor + Bluetooth SDK only | Any CARMA-specific logic |
| `src/lib/` | CARMA business logic: scoring, fraud detection, trip validation, gamification | React code, server calls |
| `src/context/` | Global React state, SDK wiring, server sync | Business formulas |
| `src/components/` | UI components grouped by domain | Direct API calls |
| `src/screens/` | Full-screen views | Inline business logic |
| `src/services/api/` | HTTP request/response per resource | Business decisions |
| `src/types/` | Aliases over `src/services/api/generated.ts` | Re-declaring what the schema already says |

### Critical rule — `src/lib/driving-sdk/`

This folder is a **generic, extractable SDK** for React Native sensor integration.
It must not contain anything specific to the CARMA application.

**Never place these inside `driving-sdk/`:**
- Trip start/end rules → belongs in `src/lib/TripValidationManager.ts`
- Fraud / public-transport detection → belongs in `src/lib/FraudDetector.ts`
- Gamification levels or point multipliers → belongs in `src/lib/gamification.ts`
- Scoring formulas → belongs on the server. The client computes no part of the score.

**Quick test:** Would this file make sense in an SDK used by a different app?
If no → put it in `src/lib/`, not in `driving-sdk/`.

## Data contract rule

Any change to API response shapes MUST be followed by:
```bash
cd mobile && npm run gen:api
```
Then commit the updated `src/services/api/generated.ts` — that is the file `gen:api` writes, and it is committed. Never edit it by hand; `src/types/index.ts` aliases it.

## No stubs

Implement complete, production-ready code. Do not commit empty functions or unresolved `// TODO` comments.
