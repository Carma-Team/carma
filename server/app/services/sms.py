from __future__ import annotations

import logging
from typing import Protocol

from app.config import settings

log = logging.getLogger(__name__)


class SmsSender(Protocol):
    async def send(self, to: str, body: str) -> None: ...


class ConsoleSmsSender:
    async def send(self, to: str, body: str) -> None:
        log.info("==== DEV SMS ====\n  to:   %s\n  body: %s\n=================", to, body)


class TwilioSmsSender:
    def __init__(self, account_sid: str, auth_token: str, from_number: str) -> None:
        from twilio.rest import Client  # imported lazily so dev installs without twilio creds still work

        self._client = Client(account_sid, auth_token)
        self._from = from_number

    async def send(self, to: str, body: str) -> None:
        # twilio-python is sync; for our volume that's fine. If it becomes a bottleneck we can
        # wrap in run_in_executor.
        try:
            self._client.messages.create(to=to, from_=self._from, body=body)
        except Exception as e:
            from app.core.audit import audit, mask_phone
            audit("sms.send.failure", to_masked=mask_phone(to), error=str(e))
            raise


def _build() -> SmsSender:
    if settings.sms_provider == "twilio":
        assert settings.twilio_account_sid and settings.twilio_auth_token and settings.twilio_from_number
        log.info("SMS provider: Twilio")
        return TwilioSmsSender(
            settings.twilio_account_sid,
            settings.twilio_auth_token,
            settings.twilio_from_number,
        )
    log.info("SMS provider: console (dev)")
    return ConsoleSmsSender()


sms_sender: SmsSender = _build()
