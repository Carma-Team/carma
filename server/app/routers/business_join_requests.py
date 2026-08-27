# No `from __future__ import annotations` here — same reason as routers/auth.py:
# SlowAPI's decorator breaks FastAPI's string-annotation resolution.

"""Public business registration join-requests (CAR-42).

Both routes are scoped to `CurrentUser`: submission takes no `phone`/`userId`
from the client, and the status read takes no request id — an applicant can
only ever see or create their own request. Approval and rejection are CAR-77.
"""

from fastapi import APIRouter, Request, status

from app.core.deps import CurrentUser, DbSession
from app.core.limiter import limiter
from app.routers.auth import SENSITIVE_LIMIT
from app.schemas.business_join_request import (
    BusinessJoinRequestIn,
    BusinessJoinRequestOut,
    BusinessJoinRequestStatusOut,
)
from app.services import business_join_requests as svc

router = APIRouter(prefix="/api/business/join-requests", tags=["business-join-requests"])


@router.post(
    "",
    response_model=BusinessJoinRequestOut,
    response_model_by_alias=True,
    status_code=status.HTTP_201_CREATED,
    summary="Submit a business registration request for admin review",
)
@limiter.limit(SENSITIVE_LIMIT)
async def submit_join_request(
    request: Request, dto: BusinessJoinRequestIn, user: CurrentUser, db: DbSession
) -> BusinessJoinRequestOut:
    return await svc.submit(db, user, dto)


@router.get(
    "/me",
    response_model=BusinessJoinRequestStatusOut,
    response_model_by_alias=True,
    summary="The authenticated applicant's own join-request status",
)
async def my_join_request(user: CurrentUser, db: DbSession) -> BusinessJoinRequestStatusOut:
    return await svc.my_status(db, user)
