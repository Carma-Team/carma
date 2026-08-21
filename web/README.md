# CARMA Business — Web

Business-facing web app (React + Vite + TypeScript). Foundation only — routing,
shared UI primitives, Hebrew/English + RTL/LTR infrastructure, local dev and
production build. Business shell, navigation and feature pages are built on
top of this in later tickets.

## Commands

```bash
npm run dev         # local dev server (Vite)
npm run build        # typecheck + production build to dist/
npm run preview       # serve the production build locally
npm run typecheck      # tsc -b, no emit
npm run lint           # ESLint
npm test               # Vitest (single run)
npm run test:watch     # Vitest (watch mode)
```

Run from the repo root instead: `npm run web:start` / `web:test` / `web:lint`.

## Structure

```
src/
├── components/ui/   ← shared UI foundation (Button, Input, Card, Dialog,
│                       Typography, LoadingState, ErrorState, EmptyState) —
│                       neutral and unbranded on purpose, see src/styles/tokens.css
├── hooks/            ← useTranslation, useLanguage, useAuth
├── i18n/             ← en.ts / he.ts string maps, LanguageContext (RTL/LTR)
├── lib/
│   ├── auth/         ← session (in-memory access token store), authApi
│   │                    (login/refresh/logout), AuthProvider, refresh
│   │                    (shared single-flight silent refresh) — CAR-217
│   └── api/          ← client.ts, the authenticated fetch wrapper future
│                        business API calls go through (retries once on a
│                        401 via a silent refresh)
├── pages/            ← route-level views, incl. SignInPage
├── routes/           ← route table (react-router-dom), ProtectedRoute
├── styles/           ← design tokens (spacing/typography/color) + global reset
└── test/             ← Vitest setup
```

## Authentication & session (CAR-217)

The access token lives in memory only (`lib/auth/session.ts`) — never
`localStorage`. A reload wipes it; what survives is an httpOnly
`carma_refresh` cookie the server sets on login, which `AuthProvider` trades
for a fresh access token on every mount (`POST /api/auth/refresh`). Routes
nested under `<ProtectedRoute />` (see `routes/router.tsx`) redirect to
`/sign-in` once that resolves as unauthenticated. `npm run dev` needs
`VITE_API_URL` — copy `.env.example` to `.env` — and the server's
`CORS_ORIGINS` needs this app's own origin, or the sign-in request never
leaves the browser (see `server/.env.example`).

## i18n & direction

Language is `'HE' | 'EN'`, defaults to Hebrew, persisted to
`localStorage['carma_lang']`. `LanguageProvider` sets `dir`/`lang` on
`<html>` once, at the app root — components use logical CSS properties
(`inset-inline-*`, `padding-inline`, …) so they follow direction automatically
instead of needing per-component RTL overrides.
