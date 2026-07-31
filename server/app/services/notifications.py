from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import CursorResult, delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Notification

# Bounds a single pull-on-open response. The client derives its unread count from
# the returned page, so this also bounds how far back an unread badge can see.
MAX_LIMIT = 50


def create(db: AsyncSession, user_id: str, type_: str, payload: dict[str, Any]) -> Notification:
    """Stage a notification on the caller's transaction.

    Deliberately does not commit: the row belongs to whatever action triggered it,
    so a rolled-back trip save must not leave a notification behind.
    """
    notification = Notification(user_id=user_id, type=type_, payload=payload)
    db.add(notification)
    return notification


async def has_unread_from(db: AsyncSession, user_id: str, type_: str, actor_id: str) -> bool:
    """True when an unread notification of this kind, about this actor, is already waiting.

    Callers use this to keep an action that can be repeated indefinitely — send a
    friend request, cancel it, send it again — from stacking one row per repetition.
    """
    existing = await db.scalar(
        select(Notification.id)
        .where(
            Notification.user_id == user_id,
            Notification.type == type_,
            Notification.read_at.is_(None),
            Notification.payload["userId"].astext == actor_id,
        )
        .limit(1)
    )
    return existing is not None


async def delete_from_actor(db: AsyncSession, user_id: str, type_: str, actor_id: str) -> None:
    """Drop notifications of this kind about this actor, read or not.

    For notifications that point at something actionable: once the underlying
    thing is gone, the row is worse than useless — it sends the user to a screen
    where the item no longer appears. Staged, not committed.
    """
    await db.execute(
        delete(Notification).where(
            Notification.user_id == user_id,
            Notification.type == type_,
            Notification.payload["userId"].astext == actor_id,
        )
    )


async def list_for_user(db: AsyncSession, user_id: str, limit: int = MAX_LIMIT) -> list[Notification]:
    rows = await db.scalars(
        select(Notification)
        .where(Notification.user_id == user_id)
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .limit(min(limit, MAX_LIMIT))
    )
    return list(rows)


async def mark_read(db: AsyncSession, user_id: str, notification_id: str) -> bool:
    """Mark one notification read. Returns False only if it is not this user's row.

    user_id is part of the WHERE clause rather than a separate ownership check, so
    another user's row can never be touched even by a crafted id. Re-marking an
    already-read row is a no-op that still returns True — the client may replay
    the call, and nothing depends on the exact read timestamp.
    """
    # `execute` is typed as returning a plain Result, which has no rowcount.
    # A DML statement always yields a CursorResult at runtime — the annotation
    # tells mypy that, it does not change behaviour. Same pattern as rewards.py.
    result: CursorResult[Any] = await db.execute(  # type: ignore[assignment]
        update(Notification)
        .where(Notification.id == notification_id, Notification.user_id == user_id)
        .values(read_at=func.coalesce(Notification.read_at, datetime.now(UTC)))
    )
    await db.commit()
    return result.rowcount > 0


async def mark_all_read(db: AsyncSession, user_id: str) -> int:
    result: CursorResult[Any] = await db.execute(  # type: ignore[assignment]
        update(Notification)
        .where(Notification.user_id == user_id, Notification.read_at.is_(None))
        .values(read_at=datetime.now(UTC))
    )
    await db.commit()
    return int(result.rowcount)
