from __future__ import annotations

import logging
from typing import Protocol

from app.config import settings

log = logging.getLogger(__name__)


class EmailSender(Protocol):
    async def send(self, to: str, subject: str, body: str) -> None: ...


class ConsoleEmailSender:
    async def send(self, to: str, subject: str, body: str) -> None:
        log.info("==== DEV EMAIL ====\n  to:   %s\n  subj: %s\n  body: %s\n===================", to, subject, body)


class SmtpEmailSender:
    def __init__(self, host: str, port: int, username: str | None, password: str | None, sender: str) -> None:
        self._host = host
        self._port = port
        self._username = username
        self._password = password
        self._from = sender

    async def send(self, to: str, subject: str, body: str) -> None:
        # smtplib is sync and this blocks the loop for the length of one SMTP
        # conversation, the same trade `sms.py` takes with twilio-python. Our
        # volume is a handful of sends an hour; if that changes, wrap it in
        # run_in_executor rather than taking on aiosmtplib for it.
        import smtplib
        from email.message import EmailMessage

        from app.core.audit import audit, hash_email

        msg = EmailMessage()
        msg["From"] = self._from
        msg["To"] = to
        msg["Subject"] = subject
        msg.set_content(body)

        try:
            with smtplib.SMTP(self._host, self._port, timeout=10) as smtp:
                smtp.starttls()
                # Some relays authorise by source address instead, and passing
                # empty credentials to those is an error rather than a no-op.
                if self._username and self._password:
                    smtp.login(self._username, self._password)
                smtp.send_message(msg)
        except Exception as e:
            audit("email.send.failure", to_hashed=hash_email(to), error=str(e))
            raise


def _build() -> EmailSender:
    if settings.email_provider == "smtp":
        assert settings.smtp_host and settings.smtp_from
        log.info("Email provider: SMTP (%s)", settings.smtp_host)
        return SmtpEmailSender(
            settings.smtp_host,
            settings.smtp_port,
            settings.smtp_username,
            settings.smtp_password,
            settings.smtp_from,
        )
    log.info("Email provider: console (dev)")
    return ConsoleEmailSender()


email_sender: EmailSender = _build()
