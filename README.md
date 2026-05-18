# CARMA

CARMA is a mobile app that tracks driving behaviour via the phone's GPS and IMU sensors. It detects risks like hard braking and generates a "CARMA Score". Safe drivers earn points redeemable for real-world vouchers in a location-based Marketplace. Post-trip insights provide positive reinforcement.

This monorepo holds three projects:

| Folder | What | Quick start |
|---|---|---|
| [`server/`](server/) | Python / FastAPI backend (production) | [`server/README.md`](server/README.md) |
| [`mobile/`](mobile/) | Expo / React Native app | `cd mobile && npm install && npm start` |
| [`mock-server/`](mock-server/) | Express + `db.json` mock (deprecated; offline-dev only) | `cd mock-server/local-server && npm install && node server.js` |

## One-command local dev

After first-time setup (see `server/README.md`), run from the repo root:

```powershell
./scripts/dev.ps1
```

It opens three windows: Postgres (Docker), the FastAPI server on `:3000`, and Expo Metro on `:8081`.

## More

- Full system documentation: [SYSTEM.md](SYSTEM.md) (English) · [SYSTEM.he.md](SYSTEM.he.md) (עברית)
- HTTP contract changes: [CHANGELOG.md](CHANGELOG.md)
- CI/CD workflows: [`.github/workflows/`](.github/workflows/)
