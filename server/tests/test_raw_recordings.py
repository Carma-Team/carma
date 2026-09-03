"""CAR-213 - storage and index for CAR-31's labelled drive recordings.

Two halves. `parse` is pure and covers the format CAR-212 settled: a
`session_start` header line followed by samples. The route half proves the
admin gate, the size cap, and that a retried upload converges on one row
instead of two drives in the index.

The DB half needs a real database - see conftest.db_session - and skips
without one.
"""

from __future__ import annotations

import gzip
import json
import uuid
from pathlib import Path

import pytest
from httpx import AsyncClient
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token
from app.models import RawRecording, User
from app.models.enums import UserRole
from app.services import raw_recordings as svc
from app.services.recording_store import LocalRecordingStore

URL = "/api/dev/recordings"


def _ndjson(
    session_id: str = "session_1724608000000",
    *,
    scenario: str = "mounted",
    samples: int = 3,
    **header: object,
) -> bytes:
    started = 1_724_608_000_000
    lines = [
        json.dumps(
            {
                "kind": "session_start",
                "version": 1,
                "sessionId": session_id,
                "startedAt": started,
                "scenario": scenario,
                "platform": "ios",
                "deviceModel": "iPhone 14",
                **header,
            }
        )
    ]
    for i in range(samples):
        lines.append(json.dumps({"t": started + (i + 1) * 100, "kind": "accel", "accel": {"x": 0, "y": 0, "z": 1}}))
    return "\n".join(lines).encode()


def _auth(user: User) -> dict[str, str]:
    token = create_access_token(user_id=user.id, email=None, phone=None, role=user.role)
    return {"Authorization": f"Bearer {token}"}


def _upload(data: bytes) -> dict[str, tuple[str, bytes, str]]:
    return {"file": ("session.ndjson", data, "application/x-ndjson")}


async def _make_user(db: AsyncSession, role: UserRole) -> User:
    user = User(id=uuid.uuid4().hex, name="Tester", role=role, is_phone_verified=True)
    db.add(user)
    await db.commit()
    return user


def test_parse_reads_the_index_out_of_the_header() -> None:
    parsed = svc.parse(_ndjson(samples=10))
    assert parsed.session_id == "session_1724608000000"
    assert parsed.scenario == "mounted"
    assert parsed.platform == "ios"
    assert parsed.device_model == "iPhone 14"
    assert parsed.format_version == 1
    assert parsed.sample_count == 10
    # Last sample is 1000 ms after the header's startedAt.
    assert parsed.duration_s == 1


def test_parse_defaults_provenance_to_staged() -> None:
    """Every drive through the debug recorder is a staged drive by construction,
    which is the strongest label we can produce cheaply (CAR-31)."""
    assert svc.parse(_ndjson()).provenance == "staged"


@pytest.mark.parametrize(
    "data",
    [
        b"",
        b'{"t":1,"kind":"accel"}',  # samples with no header - the #154 shape, before CAR-212
        b'{"kind":"session_start","version":1,"sessionId":"s","startedAt":1,"scenario":"m","platform":"ios"}',
        b"not json\n" + b'{"t":2,"kind":"accel"}',
    ],
    ids=["empty", "no-header", "header-only", "unparseable"],
)
def test_parse_refuses_a_file_it_cannot_index(data: bytes) -> None:
    with pytest.raises(svc.RecordingFormatError):
        svc.parse(data)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("scenario", "m" * 41),
        ("platform", "i" * 21),
        ("deviceModel", "d" * 81),
        ("provenance", "p" * 21),
    ],
)
def test_parse_refuses_a_header_field_wider_than_its_column(field: str, value: str) -> None:
    """Reaching the INSERT with one of these would be a 500 on an upload that is
    only malformed. The scenario case was a real gap: the charset check allowed 64
    characters into a column holding 40."""
    with pytest.raises(svc.RecordingFormatError, match=field):
        svc.parse(_ndjson(**{field: value}))


def test_parse_accepts_a_header_field_at_exactly_its_column_width() -> None:
    parsed = svc.parse(_ndjson(scenario="m" * 40, platform="i" * 20))
    assert parsed.scenario == "m" * 40


def test_parse_counts_samples_past_a_trailing_newline() -> None:
    """The recorder joins without one, but a file that picked one up on the way
    through a share sheet must not be counted as holding an extra sample."""
    assert svc.parse(_ndjson(samples=4) + b"\n").sample_count == 4


def test_parse_refuses_a_path_traversing_label() -> None:
    """scenario and sessionId both land in the object path."""
    with pytest.raises(svc.RecordingFormatError):
        svc.parse(_ndjson(scenario="../../etc"))


@pytest.mark.asyncio
async def test_local_store_writes_gzipped(tmp_path: Path) -> None:
    store = LocalRecordingStore(str(tmp_path))
    await store.put("mounted/session_1.ndjson.gz", b"hello")
    assert gzip.decompress((tmp_path / "mounted" / "session_1.ndjson.gz").read_bytes()) == b"hello"


@pytest.mark.asyncio
async def test_upload_requires_an_admin(api_client: AsyncClient) -> None:
    assert (await api_client.post(URL, files=_upload(_ndjson()))).status_code == 401


@pytest.mark.asyncio
async def test_upload_indexes_the_drive_and_is_idempotent(
    db_session: AsyncSession, db_api_client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(svc, "recording_store", LocalRecordingStore(str(tmp_path)))
    admin = await _make_user(db_session, UserRole.ADMIN)
    headers = _auth(admin)
    session_id = f"session_{uuid.uuid4().hex[:12]}"
    data = _ndjson(session_id, samples=5)

    try:
        first = await db_api_client.post(URL, files=_upload(data), headers=headers)
        assert first.status_code == 201
        body = first.json()
        assert body["sessionId"] == session_id
        assert body["sampleCount"] == 5
        assert body["objectPath"] == f"mounted/{session_id}.ndjson.gz"
        assert (tmp_path / body["objectPath"]).exists()

        # A phone retrying an upload it never saw succeed must not add a second
        # drive to the set.
        again = await db_api_client.post(URL, files=_upload(data), headers=headers)
        assert again.status_code == 200
        assert again.json()["sessionId"] == session_id

        listed = await db_api_client.get(URL, params={"scenario": "mounted"}, headers=headers)
        assert [r["sessionId"] for r in listed.json()["recordings"]].count(session_id) == 1
    finally:
        await db_session.execute(delete(RawRecording).where(RawRecording.session_id == session_id))
        await db_session.execute(delete(User).where(User.id == admin.id))
        await db_session.commit()


@pytest.mark.asyncio
async def test_two_different_drives_under_one_session_id_conflict(
    db_session: AsyncSession, db_api_client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`session_<epoch ms>` carries nothing device-specific, so two testers
    starting in the same millisecond collide. Idempotency must not turn that
    into a drive reported as stored and then dropped."""
    monkeypatch.setattr(svc, "recording_store", LocalRecordingStore(str(tmp_path)))
    admin = await _make_user(db_session, UserRole.ADMIN)
    session_id = f"session_{uuid.uuid4().hex[:12]}"

    try:
        first = await db_api_client.post(URL, files=_upload(_ndjson(session_id, samples=3)), headers=_auth(admin))
        assert first.status_code == 201
        clash = await db_api_client.post(URL, files=_upload(_ndjson(session_id, samples=9)), headers=_auth(admin))
        assert clash.status_code == 409
    finally:
        await db_session.execute(delete(RawRecording).where(RawRecording.session_id == session_id))
        await db_session.execute(delete(User).where(User.id == admin.id))
        await db_session.commit()


@pytest.mark.asyncio
async def test_deleting_the_uploader_keeps_the_drive(
    db_session: AsyncSession, db_api_client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The recording is what CAR-102 fits against; the uploader is a footnote."""
    monkeypatch.setattr(svc, "recording_store", LocalRecordingStore(str(tmp_path)))
    admin = await _make_user(db_session, UserRole.ADMIN)
    session_id = f"session_{uuid.uuid4().hex[:12]}"

    try:
        assert (
            await db_api_client.post(URL, files=_upload(_ndjson(session_id)), headers=_auth(admin))
        ).status_code == 201
        await db_session.execute(delete(User).where(User.id == admin.id))
        await db_session.commit()

        survivor = await db_session.scalar(select(RawRecording).where(RawRecording.session_id == session_id))
        assert survivor is not None
        assert survivor.uploaded_by is None
    finally:
        await db_session.execute(delete(RawRecording).where(RawRecording.session_id == session_id))
        await db_session.execute(delete(User).where(User.id == admin.id))
        await db_session.commit()


@pytest.mark.asyncio
async def test_upload_refuses_an_oversized_file(
    db_session: AsyncSession, db_api_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.config import settings

    monkeypatch.setattr(settings, "recording_max_bytes", 128)
    admin = await _make_user(db_session, UserRole.ADMIN)
    try:
        response = await db_api_client.post(URL, files=_upload(_ndjson(samples=200)), headers=_auth(admin))
        assert response.status_code == 413
    finally:
        await db_session.execute(delete(User).where(User.id == admin.id))
        await db_session.commit()


@pytest.mark.asyncio
async def test_upload_refuses_a_driver(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    driver = await _make_user(db_session, UserRole.DRIVER)
    try:
        response = await db_api_client.post(URL, files=_upload(_ndjson()), headers=_auth(driver))
        assert response.status_code == 403
    finally:
        await db_session.execute(delete(User).where(User.id == driver.id))
        await db_session.commit()
