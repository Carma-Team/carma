# Services

Business logic for the FastAPI server. Each module is a plain Python module — no framework decorators, no I/O in the pure ones.

**The scoring engine is documented in [`docs/scoring.md`](../../../docs/scoring.md).** That is the only description of the algorithm; do not restate the formula here.

| Module | What it does |
|---|---|
| `scoring.py` | The scoring formula — pure, no I/O. Trip score, driver score, points. |
| `telemetry.py` | Server-side GPS analysis — independent event detection and trace confidence. Pure. |
| `trips.py` | Trip intake: validation gates, sourcing scoring inputs, persistence. |
| `risk.py` | Time-of-day risk multiplier. |
| `levels.py`, `rewards.py`, `leaderboard.py` | Gamification. |
| `fraud.py` | Fraud report intake — see [`docs/fraud-detection.md`](../../../docs/fraud-detection.md). |
| `auth.py`, `sms.py`, `users.py`, `friends.py`, `invites.py`, `business.py` | Accounts, messaging, social, partners. |
