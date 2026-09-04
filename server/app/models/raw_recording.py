from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class RawRecording(Base, TimestampMixin):
    """One staged calibration drive that has left the phone (CAR-213).

    The row is an index, not the data: the NDJSON itself lives in the recording
    store (`services/recording_store.py`) and this says what it is and where it
    is. CAR-31 asks for drives "somewhere the next person can find it", and a
    container full of `session_<epoch>.ndjson.gz` is not findable - the question
    an analyst actually asks is "which drives are mounted, on iOS, over five
    minutes", and that is a query, not a file listing.

    Every column here is read out of the file's own `session_start` header
    rather than taken from the client as a separate field. Two sources for the
    same fact drift, and the file is the one that outlives this table.
    """

    __tablename__ = "raw_recordings"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: uuid.uuid4().hex)
    # The recorder's own id for the drive, and the idempotency key for upload:
    # a phone that retries a failed upload must not mint a second row.
    session_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    # Whoever uploaded it, which is not necessarily whoever drove it. Kept for
    # provenance questions ("who staged this one"), never for scoring. Nullable
    # with SET NULL because a deleted account must not take a drive with it -
    # the recording is evidence CAR-102 fits against, the uploader is a
    # footnote.
    uploaded_by: Mapped[str | None] = mapped_column(String(32), ForeignKey("users.id", ondelete="SET NULL"))

    scenario: Mapped[str] = mapped_column(String(40), nullable=False)
    platform: Mapped[str] = mapped_column(String(20), nullable=False)
    device_model: Mapped[str | None] = mapped_column(String(80), nullable=True)
    # docs/fraud-detection.md Stage 3 requires this per sample, and a set that
    # mixes provenances without recording them inherits the weakest one. Every
    # drive collected through the debug recorder is a staged drive by
    # construction, so that is the default rather than a field a tester can
    # forget.
    provenance: Mapped[str] = mapped_column(String(20), nullable=False, default="staged")
    # `version` from the header. A format change is why this is stored: without
    # it, a re-run of CAR-102 cannot tell which files it can still parse.
    format_version: Mapped[int] = mapped_column(Integer, nullable=False)

    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    duration_s: Mapped[int] = mapped_column(Integer, nullable=False)
    sample_count: Mapped[int] = mapped_column(Integer, nullable=False)

    # Of the uncompressed NDJSON, so the two survive a change of compression.
    byte_size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    # Store-relative, not a URL: an account or container rename must not
    # invalidate the index, and the local store has no URL at all.
    object_path: Mapped[str] = mapped_column(String(200), nullable=False)
