from __future__ import annotations

import base64
import binascii
from datetime import datetime

from fastapi import HTTPException, status


def encode_cursor(sort_at: datetime, row_id: str) -> str:
    """Opaque keyset cursor over a (timestamp, id) pair.

    CAR-79 is the first paginated endpoint in this codebase, so this is the
    house pattern future keyset-paged endpoints should reuse rather than
    inventing their own encoding. `row_id` is the tiebreaker for rows sharing
    a timestamp — callers must never key a page on the timestamp alone.
    """
    raw = f"{sort_at.isoformat()}|{row_id}"
    return base64.urlsafe_b64encode(raw.encode()).decode()


def decode_cursor(cursor: str) -> tuple[datetime, str]:
    try:
        raw = base64.urlsafe_b64decode(cursor.encode()).decode()
        sort_at_str, row_id = raw.rsplit("|", 1)
        if not row_id:
            raise ValueError("empty id")
        sort_at = datetime.fromisoformat(sort_at_str)
        # `encode_cursor` only ever writes an aware `isoformat()` — a naive value
        # here means a hand-crafted cursor, not one this module produced. Reject
        # it rather than comparing it against an aware `settled_at` column, which
        # Postgres/asyncpg would otherwise error on (or worse, silently mishandle).
        if sort_at.tzinfo is None:
            raise ValueError("naive timestamp")
        return sort_at, row_id
    except (ValueError, UnicodeDecodeError, binascii.Error) as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid pagination cursor") from e
