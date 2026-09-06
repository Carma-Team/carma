from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.audit import audit, hash_email
from app.core.security import hash_code, random_digits, verify_code
from app.models.email_verification import EmailVerificationCode
from app.models.user import User
from app.schemas.auth import MessageOut, OtpSent
from app.services.email import email_sender

log = logging.getLogger(__name__)

# Matches the Hebrew of the OTP texts in `services.auth`. There is no language
# contract on server-supplied text yet (CAR-248), so a second convention here
# would be one more thing to unpick when there is.
_SUBJECT = "CARMA: אימות כתובת המייל"
_BODY = "קוד האימות שלך הוא {code}. תוקף ל-{minutes} דקות.\nאם לא ביקשת לאמת כתובת ב-CARMA, התעלם מההודעה."

# Wrong guesses one code absorbs before it is spent. The code is six digits over
# five minutes, so this is not what makes brute force impractical - it is what
# stops the window being usable at all if the per-IP limit is ever loosened.
_MAX_ATTEMPTS = 5

_REJECTED = "Invalid or expired code — request a new one"


def _now() -> datetime:
    return datetime.now(UTC)


async def _over_quota(db: AsyncSession, user: User) -> bool:
    """Whether this account has had its hour's worth of codes.

    Keyed on the account rather than the address: a caller who can edit their own
    email could otherwise reset the count by changing it, which is the same hole
    `services.auth._over_otp_quota` closes by counting the destination number
    instead of the caller's address.
    """
    since = _now() - timedelta(hours=1)
    recent = await db.scalar(
        select(func.count())
        .select_from(EmailVerificationCode)
        .where(EmailVerificationCode.user_id == user.id, EmailVerificationCode.created_at >= since)
    )
    if (recent or 0) >= settings.email_verification_max_per_hour:
        audit("auth.email_verification.throttled", user_id=user.id, sent_last_hour=recent)
        return True
    return False


async def request_verification(db: AsyncSession, user: User) -> OtpSent:
    """Send a code to the address on the account.

    Says out loud that the account has no email, or is already verified. Unlike
    the phone doors this one cannot leak anything by being specific: the caller
    is holding a session for the account they are asking about.
    """
    if user.email is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This account has no email address to verify")
    if user.is_email_verified:
        raise HTTPException(status.HTTP_409_CONFLICT, "This email address is already verified")
    if await _over_quota(db, user):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Too many verification emails requested. Try again later.",
        )

    code = random_digits(settings.otp_length)
    expires_at = _now() + timedelta(seconds=settings.otp_ttl_seconds)

    await db.execute(
        update(EmailVerificationCode)
        .where(EmailVerificationCode.user_id == user.id, EmailVerificationCode.consumed_at.is_(None))
        .values(consumed_at=_now())
    )
    db.add(
        EmailVerificationCode(
            user_id=user.id,
            email=user.email,
            code_hash=hash_code(code),
            expires_at=expires_at,
        )
    )
    await db.commit()

    minutes = round(settings.otp_ttl_seconds / 60)
    await email_sender.send(user.email, _SUBJECT, _BODY.format(code=code, minutes=minutes))

    if settings.env != "production":
        log.debug("[dev-email-verification] user=%s code=%s", user.id, code)

    audit("auth.email_verification.issued", user_id=user.id, email_hashed=hash_email(user.email))
    return OtpSent(message="Verification email sent", expires_in_seconds=settings.otp_ttl_seconds)


def _rejected(user: User, reason: str) -> HTTPException:
    audit("auth.email_verification.failure", user_id=user.id, reason=reason)
    return HTTPException(status.HTTP_400_BAD_REQUEST, _REJECTED)


async def confirm_verification(db: AsyncSession, user: User, code: str) -> MessageOut:
    """Trade a valid code for `is_email_verified`.

    The address is compared against the one the code was minted for, not just
    taken from the user: a driver who changed their email while a code was in
    flight would otherwise verify the new address with a code sent to the old.
    """
    if user.email is None:
        raise _rejected(user, "no_email")
    if user.is_email_verified:
        return MessageOut(message="Email already verified")

    row = await db.scalar(
        select(EmailVerificationCode)
        .where(EmailVerificationCode.user_id == user.id, EmailVerificationCode.consumed_at.is_(None))
        .order_by(EmailVerificationCode.created_at.desc())
    )
    if row is None:
        raise _rejected(user, "no_active_code")
    if row.expires_at < _now():
        raise _rejected(user, "expired")
    if row.email != user.email:
        # Spend it rather than leaving it live against the old address.
        row.consumed_at = _now()
        await db.commit()
        raise _rejected(user, "email_changed")
    if row.attempts >= _MAX_ATTEMPTS:
        raise _rejected(user, "too_many_attempts")

    if not verify_code(code, row.code_hash):
        row.attempts += 1
        if row.attempts >= _MAX_ATTEMPTS:
            row.consumed_at = _now()
        await db.commit()
        raise _rejected(user, "bad_code")

    row.consumed_at = _now()
    user.is_email_verified = True
    await db.commit()

    audit("auth.email_verification.confirmed", user_id=user.id, email_hashed=hash_email(user.email))
    return MessageOut(message="Email verified")
