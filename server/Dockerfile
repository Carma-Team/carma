FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libpq-dev curl \
 && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY requirements.txt ./
RUN pip install -r requirements.txt

FROM base AS runtime
COPY --from=deps /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=deps /usr/local/bin /usr/local/bin

RUN useradd --create-home --uid 1001 carma
COPY --chown=carma:carma . /app
USER carma

ENV PORT=3000
EXPOSE 3000

# Migrations deliberately do NOT run here. This app scales 0→10 replicas, and
# every replica booting `alembic upgrade head` at once races: one wins, the rest
# die on an object that already exists and crash-loop. Booting is also the worst
# place to fail — a bad migration takes the whole app down instead of stopping
# the deploy. The `carma-migrate` job in deploy.yml runs them once, before the
# new image is rolled out.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
