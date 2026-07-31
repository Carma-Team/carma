from __future__ import annotations

from datetime import datetime
from typing import Any

from app.schemas._base import CamelModel


class NotificationOut(CamelModel):
    """Wire shape for one notification.

    `type` + `payload` rather than rendered title/body: the client renders the
    text through its own i18n, so old rows follow a language switch instead of
    being frozen in the language they were created in.
    """

    id: str
    type: str
    payload: dict[str, Any]
    read_at: datetime | None
    created_at: datetime
