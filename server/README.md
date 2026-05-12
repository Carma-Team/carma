# CARMA Server (Python / FastAPI)

Backend API for CARMA — safe-driving rewards platform. FastAPI + SQLAlchemy 2.0 async + PostgreSQL/PostGIS.

## Quick start

```powershell
cd server

# 1. Virtualenv
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements-dev.txt

# 2. Env vars
copy .env.example .env

# 3. DB
docker compose up -d db
alembic revision --autogenerate -m "init"
alembic upgrade head

# 4. Seed
python -m app.seed

# 5. Run
uvicorn app.main:app --reload --host 0.0.0.0 --port 3000
```

- API: `http://localhost:3000/api/...`
- Swagger: `http://localhost:3000/api/docs`
- Health: `http://localhost:3000/health`

Demo login (after seed): `daniel@carma.app` / `password123`.

## Auth

- `POST /api/auth/register` — `{ name, email, password, phone?, city?, age?, licenseYear? }` → `{ token, user }`
- `POST /api/auth/login` — `{ email, password }` → `{ token, user }`
- `GET /api/auth/me` — current user (requires `Authorization: Bearer <token>`)

OTP path (spec 4.2.1):
- `POST /api/auth/otp/register` · `POST /api/auth/otp/request` · `POST /api/auth/otp/verify`

Set `SMS_PROVIDER=twilio` plus the `TWILIO_*` vars for real SMS. Otherwise OTPs are logged to stdout.

## Common commands

```powershell
uvicorn app.main:app --reload    # dev server
ruff check . ; ruff format .     # lint + format
mypy app                         # typecheck
pytest                           # tests
alembic revision --autogenerate -m "msg"   # new migration from model changes
alembic upgrade head             # apply migrations
python -m app.seed               # reseed
```

## Deploying to Azure

See [../SYSTEM.md](../SYSTEM.md) §11 for the `az` commands and `.github/workflows/deploy.yml`.
