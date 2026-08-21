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
├── hooks/            ← useTranslation, useLanguage
├── i18n/             ← en.ts / he.ts string maps, LanguageContext (RTL/LTR)
├── pages/            ← route-level views
├── routes/           ← route table (react-router-dom)
├── styles/           ← design tokens (spacing/typography/color) + global reset
└── test/             ← Vitest setup
```

## i18n & direction

Language is `'HE' | 'EN'`, defaults to Hebrew, persisted to
`localStorage['carma_lang']`. `LanguageProvider` sets `dir`/`lang` on
`<html>` once, at the app root — components use logical CSS properties
(`inset-inline-*`, `padding-inline`, …) so they follow direction automatically
instead of needing per-component RTL overrides.
