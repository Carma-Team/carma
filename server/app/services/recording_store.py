"""Where a staged calibration recording's bytes actually land (CAR-213).

Two implementations behind one Protocol, chosen by `RECORDING_STORE` - the same
shape `services/sms.py` uses for console-versus-Twilio, and for the same reason:
a clone with no cloud account has to be able to run the endpoint and its tests.

Everything is stored gzipped. NDJSON of near-identical lines compresses about
tenfold, which turns a 200-drive set from ~220 MB into ~25 MB, and `gunzip` is
already on the machine of whoever works CAR-102.
"""

from __future__ import annotations

import gzip
import logging
from pathlib import Path
from typing import Protocol

import anyio

from app.config import settings

log = logging.getLogger(__name__)


class RecordingStore(Protocol):
    async def put(self, object_path: str, data: bytes) -> None: ...


class LocalRecordingStore:
    """Writes under `RECORDING_LOCAL_DIR`. Development and tests only."""

    def __init__(self, root: str) -> None:
        self._root = Path(root)

    async def put(self, object_path: str, data: bytes) -> None:
        target = self._root / object_path
        await anyio.to_thread.run_sync(lambda: target.parent.mkdir(parents=True, exist_ok=True))
        await anyio.to_thread.run_sync(lambda: target.write_bytes(gzip.compress(data)))


class AzureBlobRecordingStore:
    """Writes to one blob container, one blob per drive.

    The synchronous SDK on a worker thread, not `azure.storage.blob.aio` - the
    async client's only transport is aiohttp, a whole extra HTTP stack in the
    image for an internal endpoint that handles a megabyte a few times a week.
    Same trade `TwilioSmsSender` already makes.
    """

    def __init__(self, connection_string: str, container: str) -> None:
        from azure.storage.blob import BlobServiceClient

        self._service = BlobServiceClient.from_connection_string(connection_string)
        self._container = container

    def _put_sync(self, object_path: str, data: bytes) -> None:
        from azure.core.exceptions import ResourceNotFoundError

        blob = gzip.compress(data)
        client = self._service.get_container_client(self._container)
        # overwrite=True so a retried upload of a session that was stored but
        # whose index row never committed converges instead of failing forever.
        try:
            client.upload_blob(name=object_path, data=blob, overwrite=True)
        except ResourceNotFoundError:
            # Only the very first drive gets here. Creating the container up
            # front on every upload would be a round trip per call, and it
            # would break outright on a container-scoped SAS - a credential
            # that can write blobs but cannot create the container it lives in,
            # which is the safer thing to hand a server.
            client.create_container()
            client.upload_blob(name=object_path, data=blob, overwrite=True)

    async def put(self, object_path: str, data: bytes) -> None:
        await anyio.to_thread.run_sync(self._put_sync, object_path, data)


def _build() -> RecordingStore:
    if settings.recording_store == "azure":
        assert settings.recording_blob_connection_string
        log.info("Recording store: Azure Blob container %s", settings.recording_blob_container)
        return AzureBlobRecordingStore(
            settings.recording_blob_connection_string,
            settings.recording_blob_container,
        )
    log.info("Recording store: local directory %s (dev)", settings.recording_local_dir)
    return LocalRecordingStore(settings.recording_local_dir)


recording_store: RecordingStore = _build()
