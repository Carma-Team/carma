from __future__ import annotations

from fastapi import APIRouter

from app.core.deps import CurrentUser

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get("", summary="List notifications for the current user (empty until modelled)")
async def list_notifications(_user: CurrentUser) -> list[dict[str, object]]:
    return []
