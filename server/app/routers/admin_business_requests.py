"""CAR-77 — admin review of business join requests created by CAR-42.

Every route here requires `CurrentAdmin`, which resolves ADMIN from the
authenticated user's current DB row, never a JWT claim. `list` never changes
state; `approve` and `reject` are the only two writers, and both lock their
target row first so two admins racing the same request serialize instead of
double-acting on it.
"""

from __future__ import annotations

from fastapi import APIRouter, Query, status

from app.core.deps import CurrentAdmin, DbSession
from app.schemas.business_join_request import (
    BusinessJoinRequestAdminListOut,
    BusinessJoinRequestAdminOut,
    BusinessJoinRequestRejectIn,
)
from app.services import business_join_requests as svc

router = APIRouter(prefix="/api/admin/business-requests", tags=["admin"])


@router.get(
    "",
    response_model=BusinessJoinRequestAdminListOut,
    response_model_by_alias=True,
    summary="List business join requests for review, newest first",
)
async def list_requests(
    admin: CurrentAdmin,
    db: DbSession,
    status_filter: str | None = Query(default=None, alias="status"),
) -> BusinessJoinRequestAdminListOut:
    return await svc.list_requests(db, svc.parse_status_filter(status_filter))


@router.post(
    "/{request_id}/approve",
    response_model=BusinessJoinRequestAdminOut,
    response_model_by_alias=True,
    summary="Approve a pending business join request",
)
async def approve_request(request_id: str, admin: CurrentAdmin, db: DbSession) -> BusinessJoinRequestAdminOut:
    return await svc.approve(db, admin, request_id)


@router.post(
    "/{request_id}/reject",
    response_model=BusinessJoinRequestAdminOut,
    response_model_by_alias=True,
    status_code=status.HTTP_200_OK,
    summary="Reject a pending business join request",
)
async def reject_request(
    request_id: str, dto: BusinessJoinRequestRejectIn, admin: CurrentAdmin, db: DbSession
) -> BusinessJoinRequestAdminOut:
    return await svc.reject(db, admin, request_id, dto.reviewer_note)
