from __future__ import annotations

import time

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import text

from app.core.deps import DbSession

router = APIRouter(prefix="/health", tags=["health"])

_started = time.time()


@router.get("", summary="Readiness probe — verifies DB connectivity")
async def health(db: DbSession) -> dict[str, object]:
    try:
        await db.execute(text("SELECT 1"))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, f"db unreachable: {e}") from e
    return {"status": "ok", "db": "ok"}


@router.get("/live", summary="Liveness probe")
async def live() -> dict[str, object]:
    return {"status": "ok", "uptime": int(time.time() - _started)}
