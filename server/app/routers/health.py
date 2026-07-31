from __future__ import annotations

import time

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import text

from app.core.deps import DbSession
from app.core.limiter import limiter

router = APIRouter(prefix="/health", tags=["health"])

_started = time.time()

# Both probes are exempt from the default limit. Azure polls them on a fixed
# interval from one address, so they share a single counter — and a 429 on the
# liveness probe reads as a dead container and gets it restarted. A limit that
# turns a busy minute into a restart loop is worse than no limit here.


@router.get("", summary="Readiness probe — verifies DB connectivity")
@limiter.exempt  # type: ignore[misc]  # slowapi ships `exempt` unannotated
async def health(db: DbSession) -> dict[str, object]:
    try:
        await db.execute(text("SELECT 1"))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, f"db unreachable: {e}") from e
    return {"status": "ok", "db": "ok"}


@router.get("/live", summary="Liveness probe")
@limiter.exempt  # type: ignore[misc]  # slowapi ships `exempt` unannotated
async def live() -> dict[str, object]:
    return {"status": "ok", "uptime": int(time.time() - _started)}
