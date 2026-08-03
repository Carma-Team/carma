from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Response, status

from app.core.deps import CurrentUser, DbSession
from app.schemas.notification import NotificationOut
from app.services import notifications as svc

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get(
    "",
    response_model=list[NotificationOut],
    response_model_by_alias=True,
    summary="List the current user's notifications, newest first",
)
async def list_notifications(
    user: CurrentUser,
    db: DbSession,
    limit: Annotated[int, Query(ge=1, le=svc.MAX_LIMIT)] = svc.MAX_LIMIT,
) -> list[NotificationOut]:
    rows = await svc.list_for_user(db, user.id, limit)
    return [NotificationOut.model_validate(r) for r in rows]


@router.post(
    "/read-all",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Mark every unread notification as read (what the client calls on opening the tab)",
)
async def mark_all_read(user: CurrentUser, db: DbSession) -> Response:
    await svc.mark_all_read(db, user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# Declared after /read-all so the literal path wins over this parameterised one.
@router.post(
    "/{notification_id}/read",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Mark a single notification as read",
)
async def mark_read(notification_id: str, user: CurrentUser, db: DbSession) -> Response:
    if not await svc.mark_read(db, user.id, notification_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Notification not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
