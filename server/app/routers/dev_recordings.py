from __future__ import annotations

from fastapi import APIRouter, File, HTTPException, Response, UploadFile, status

from app.config import settings
from app.core.deps import CurrentAdmin, DbSession
from app.schemas.raw_recording import RawRecordingOut, RawRecordingsOut
from app.services import raw_recordings as svc

router = APIRouter(prefix="/api/dev/recordings", tags=["recordings"])

_CHUNK = 64 * 1024


async def _read_bounded(file: UploadFile) -> bytes:
    """Read the upload, refusing anything over `recording_max_bytes`.

    Not an ingress limit: Starlette has already parsed the multipart body into a
    spooled temporary file by the time this route runs, so the bytes have
    arrived either way. What it bounds is what this process holds in memory,
    hashes, gzips and stores - and it tells the caller the file was refused
    instead of silently keeping a runaway one.
    """
    chunks: list[bytes] = []
    total = 0
    while chunk := await file.read(_CHUNK):
        total += len(chunk)
        if total > settings.recording_max_bytes:
            raise HTTPException(
                status.HTTP_413_CONTENT_TOO_LARGE,
                f"Recording exceeds {settings.recording_max_bytes} bytes",
            )
        chunks.append(chunk)
    return b"".join(chunks)


@router.post(
    "",
    response_model=RawRecordingOut,
    response_model_by_alias=True,
    summary="Upload one staged calibration drive. Internal: admin accounts only.",
)
async def upload_recording(
    db: DbSession,
    admin: CurrentAdmin,
    response: Response,
    file: UploadFile = File(...),
) -> RawRecordingOut:
    """Admin-gated rather than open to any signed-in driver.

    The recorder itself is a debug-menu tool a regular build never exposes, but
    the endpoint is reachable in every environment, and an authenticated
    stranger posting megabytes into the container would be a storage bill with
    no owner. Whoever stages a calibration drive gets an admin account; that is
    a smaller ask than a second permission model for one internal route.
    """
    # A production container running the local store would return 201 and lose
    # the file with the next revision - the one failure mode this endpoint
    # exists to prevent. Refused here rather than at startup: an internal
    # calibration route with nowhere to write is not a reason for the whole API
    # to refuse to boot.
    if settings.env == "production" and settings.recording_store == "local":
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "No durable recording store configured - set RECORDING_STORE=azure",
        )

    data = await _read_bounded(file)
    try:
        recording, created = await svc.store(db, data, uploaded_by=admin.id)
    except svc.RecordingFormatError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e)) from e
    except svc.RecordingConflictError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from e
    response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
    return RawRecordingOut.model_validate(recording)


@router.get(
    "",
    response_model=RawRecordingsOut,
    response_model_by_alias=True,
    summary="The labelled drive set, newest first. Internal: admin accounts only.",
)
async def list_recordings(
    db: DbSession,
    admin: CurrentAdmin,
    scenario: str | None = None,
    platform: str | None = None,
) -> RawRecordingsOut:
    """What CAR-31 means by "somewhere the next person can find it" - the answer
    to "which drives do we already have" without listing a storage container."""
    rows = await svc.list_recordings(db, scenario=scenario, platform=platform)
    return RawRecordingsOut(recordings=[RawRecordingOut.model_validate(r) for r in rows])
