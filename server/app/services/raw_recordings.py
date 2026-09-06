"""Indexing and storing staged calibration drives (CAR-213).

The uploaded file is the NDJSON that `driving-sdk/sensors/RawSampleRecorder.ts`
writes, in the format CAR-212 settled: a `session_start` header line, then one
line per sample. Everything the index knows is read back out of that header, so
the row and the file cannot disagree.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import RawRecording
from app.services.recording_store import recording_store

HEADER_KIND = "session_start"

# `session_id` and `scenario` both go into the object path, so anything outside
# this set is refused rather than escaped - a scenario label is a plain word the
# tester picks in the debug menu, and there is no reason for one to contain a
# slash.
_SAFE = re.compile(r"^[A-Za-z0-9_-]+$")

# Every string the header contributes to the index, with the width of the column
# it lands in. Checked here rather than left to the INSERT: a header field one
# character too long would otherwise reach Postgres and come back as a 500 on an
# upload that is merely malformed. Keep in step with `models/raw_recording.py`.
_MAX_LENGTHS = {
    "sessionId": 64,
    "scenario": 40,
    "platform": 20,
    "deviceModel": 80,
    "provenance": 20,
}


class RecordingFormatError(ValueError):
    """The upload is not a recording this server can index."""


class RecordingConflictError(ValueError):
    """A different file is already stored under this session id."""


@dataclass(frozen=True)
class ParsedRecording:
    session_id: str
    scenario: str
    platform: str
    device_model: str | None
    provenance: str
    format_version: int
    started_at: datetime
    duration_s: int
    sample_count: int


def _checked(key: str, value: str) -> str:
    limit = _MAX_LENGTHS[key]
    if len(value) > limit:
        raise RecordingFormatError(f"session_start header field {key} is longer than {limit} characters")
    return value


def _require_str(header: dict[str, Any], key: str) -> str:
    value = header.get(key)
    if not isinstance(value, str) or not value:
        raise RecordingFormatError(f"session_start header is missing {key}")
    return _checked(key, value)


def _optional_str(header: dict[str, Any], key: str, default: str | None) -> str | None:
    value = header.get(key)
    if not isinstance(value, str) or not value:
        return default
    return _checked(key, value)


def parse(data: bytes) -> ParsedRecording:
    # Indices into the buffer rather than `data.split(b"\n")`: a 32 MB recording
    # is ~350k lines, and splitting builds that many bytes objects so that three
    # of them can be read. Only the trailing whitespace is walked here;
    # find, rfind and count are each one pass in C over the original buffer.
    end = len(data)
    while end and data[end - 1] in b"\n\r \t":
        end -= 1
    if end == 0:
        raise RecordingFormatError("Recording is empty")

    first_nl = data.find(b"\n", 0, end)
    try:
        header = json.loads(data[: first_nl if first_nl != -1 else end])
    except ValueError as e:
        raise RecordingFormatError("First line is not JSON") from e
    if not isinstance(header, dict) or header.get("kind") != HEADER_KIND:
        raise RecordingFormatError(f"First line must be a {HEADER_KIND} header (CAR-212)")

    session_id = _require_str(header, "sessionId")
    scenario = _require_str(header, "scenario")
    if not _SAFE.match(session_id) or not _SAFE.match(scenario):
        raise RecordingFormatError("sessionId and scenario must be [A-Za-z0-9_-]")

    started_ms = header.get("startedAt")
    if not isinstance(started_ms, int | float):
        raise RecordingFormatError("session_start header is missing startedAt")
    version = header.get("version")
    if not isinstance(version, int):
        raise RecordingFormatError("session_start header is missing version")

    # A header and nothing else is a session that recorded no samples. Storing it
    # would put a drive in the index that CAR-102 cannot fit anything against.
    if first_nl == -1:
        raise RecordingFormatError("Recording has a header but no samples")

    try:
        last = json.loads(data[data.rfind(b"\n", 0, end) + 1 : end])
        last_t = float(last["t"])
    except (ValueError, KeyError, TypeError) as e:
        raise RecordingFormatError("Last line is not a timestamped sample") from e

    return ParsedRecording(
        session_id=session_id,
        scenario=scenario,
        platform=_require_str(header, "platform"),
        device_model=_optional_str(header, "deviceModel", None),
        # Anything arriving through the debug recorder is a staged drive by
        # construction; the field exists so a later self-reported or
        # transit-cross-referenced set can say so (docs/fraud-detection.md).
        provenance=_optional_str(header, "provenance", "staged") or "staged",
        format_version=version,
        started_at=datetime.fromtimestamp(started_ms / 1000, tz=UTC),
        duration_s=max(0, int((last_t - started_ms) / 1000)),
        # One newline per line break and no blank lines, so the count is
        # exactly the number of sample lines following the header.
        sample_count=data.count(b"\n", 0, end),
    )


async def store(db: AsyncSession, data: bytes, uploaded_by: str) -> tuple[RawRecording, bool]:
    """Index and persist one recording. Returns the row and whether it is new.

    Keyed on the recorder's own session id, so a phone retrying an upload it
    never saw succeed converges on the one row instead of filling the index with
    duplicates of the same drive.
    """
    parsed = parse(data)
    digest = hashlib.sha256(data).hexdigest()

    existing = await db.scalar(select(RawRecording).where(RawRecording.session_id == parsed.session_id))
    if existing is not None:
        return _reconcile(existing, digest), False

    object_path = f"{parsed.scenario}/{parsed.session_id}.ndjson.gz"
    # Stored before the row is committed: an object with no row is an orphan a
    # re-upload heals, while a row pointing at nothing is an index entry that
    # lies to whoever works CAR-102.
    await recording_store.put(object_path, data)

    recording = RawRecording(
        session_id=parsed.session_id,
        uploaded_by=uploaded_by,
        scenario=parsed.scenario,
        platform=parsed.platform,
        device_model=parsed.device_model,
        provenance=parsed.provenance,
        format_version=parsed.format_version,
        started_at=parsed.started_at,
        duration_s=parsed.duration_s,
        sample_count=parsed.sample_count,
        byte_size=len(data),
        sha256=digest,
        object_path=object_path,
    )
    db.add(recording)
    try:
        await db.commit()
    except IntegrityError:
        # Two uploads of one drive raced past the check above. The unique index
        # on session_id is what makes that safe; the loser reads back the
        # winner's row rather than failing an upload whose bytes did land.
        await db.rollback()
        raced = await db.scalar(select(RawRecording).where(RawRecording.session_id == parsed.session_id))
        if raced is None:
            raise
        return _reconcile(raced, digest), False
    await db.refresh(recording)
    return recording, True


def _reconcile(existing: RawRecording, digest: str) -> RawRecording:
    """Guard the one way idempotency can silently lose a drive.

    The recorder mints `session_<epoch ms>` with nothing device-specific in it,
    so two testers who start a drive in the same millisecond produce the same
    id. Returning the first row would report the second drive as stored and
    drop it. Same bytes is a retry; different bytes is a collision, and the
    tester has to hear about it.
    """
    if existing.sha256 != digest:
        raise RecordingConflictError(f"A different recording is already stored as {existing.session_id}")
    return existing


async def list_recordings(
    db: AsyncSession, scenario: str | None = None, platform: str | None = None, limit: int = 100
) -> list[RawRecording]:
    stmt = select(RawRecording).order_by(RawRecording.started_at.desc()).limit(limit)
    if scenario:
        stmt = stmt.where(RawRecording.scenario == scenario)
    if platform:
        stmt = stmt.where(RawRecording.platform == platform)
    return list(await db.scalars(stmt))
