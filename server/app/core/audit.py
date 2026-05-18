"""Domain & security audit events.

Use at the boundaries that matter for support / forensics — not as a general
debug logger. Each call writes one structured line via the `carma.audit` logger;
fields land in the JSON record (and Application Insights' customDimensions).

Example:
    audit("auth.login.success", user_id=user.id, via="email")
"""

from __future__ import annotations

import hashlib
import logging
from typing import Any

_audit = logging.getLogger("carma.audit")


def audit(event: str, **fields: Any) -> None:
    _audit.info(event, extra={"event": event, **fields})


def mask_phone(phone: str | None) -> str:
    """+972501234567 -> +9725****567 — kept for support flows."""
    if not phone or len(phone) < 8:
        return "***"
    return f"{phone[:5]}****{phone[-3:]}"


def hash_email(email: str | None) -> str:
    """Stable 8-char hash so we can correlate failed-login attempts without storing the email."""
    if not email:
        return "***"
    return hashlib.sha256(email.lower().encode()).hexdigest()[:8]
