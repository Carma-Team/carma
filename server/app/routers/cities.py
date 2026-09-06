from __future__ import annotations

import hashlib
import json

from fastapi import APIRouter, Request, Response, status

from app.core.deps import DbSession
from app.schemas.city import CitiesOut
from app.services import cities as svc

router = APIRouter(prefix="/api", tags=["cities"])

# One day. The list is the CBS settlements register, which changes a few times a
# year and only ever ships with a migration, so a client holding a stale copy for
# a day is holding a correct one.
_MAX_AGE = 86_400

# Built once per process. The rows only change when a migration runs, and a
# migration means a deploy, which means a new process. Registration is the hot
# caller and the ticket is explicit that it must not be a database round trip
# per signup (CAR-218).
_cached: tuple[str, CitiesOut] | None = None


async def _payload(db: DbSession) -> tuple[str, CitiesOut]:
    global _cached
    if _cached is None:
        body = await svc.all_cities(db)
        digest = hashlib.sha256(
            json.dumps(body.model_dump(by_alias=True), ensure_ascii=False, sort_keys=True).encode()
        ).hexdigest()[:32]
        _cached = (f'"{digest}"', body)
    return _cached


@router.get(
    "/cities",
    response_model=CitiesOut,
    response_model_by_alias=True,
    summary="The canonical Israeli settlement list. Public: registration reads it before a token exists.",
)
async def list_cities(request: Request, response: Response, db: DbSession) -> CitiesOut | Response:
    """Deliberately unauthenticated.

    Registration is the first consumer and runs before a token exists; wiring the
    picker to the authenticated leaderboard endpoint is what left it empty for
    every registering user (CAR-224). No new abuse surface: `middlewares/
    rate_limit.py` counts before authentication, so the per-IP floor already
    covers this route, and the response is public reference data with no PII.
    """
    etag, body = await _payload(db)
    response.headers["Cache-Control"] = f"public, max-age={_MAX_AGE}"
    response.headers["ETag"] = etag
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=dict(response.headers))
    return body
