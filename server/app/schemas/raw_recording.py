from __future__ import annotations

from datetime import datetime

from app.schemas._base import CamelModel


class RawRecordingOut(CamelModel):
    """One staged calibration drive in the index (CAR-213).

    `objectPath` is deliberately store-relative rather than a download URL. The
    consumer is whoever works CAR-102, pulling files in bulk with Storage
    Explorer or azcopy, not a client following a link - and a signed URL minted
    here would expire long before an analysis run finishes.
    """

    session_id: str
    scenario: str
    platform: str
    device_model: str | None
    provenance: str
    format_version: int
    started_at: datetime
    duration_s: int
    sample_count: int
    byte_size: int
    sha256: str
    object_path: str


class RawRecordingsOut(CamelModel):
    recordings: list[RawRecordingOut]
