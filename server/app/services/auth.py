from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.audit import audit, hash_email, mask_phone
from app.core.security import (
    create_access_token,
    hash_code,
    hash_password,
    random_digits,
    verify_code,
    verify_password,
)
from app.models import Language, OtpCode, User, UserRole
from app.schemas.auth import AuthOut, LoginIn, OtpRegisterIn, OtpSent, OtpVerifyIn, RegisterIn
from app.schemas.user import UserOut
from app.services.sms import sms_sender

log = logging.getLogger(__name__)

OTP_PURPOSE = "LOGIN"

# One answer for every way an OTP can fail to let you in. A different status or
# wording for "no such phone" turns this endpoint into a directory of who has a
# CARMA account — which `request_login_otp` already goes out of its way to hide.
# The caller's next move is the same in every case: ask for a new code.
OTP_REJECTED = "Invalid or expired code — request a new one"


def _now() -> datetime:
    return datetime.now(UTC)


def _assert_not_locked(user: User) -> None:
    if user.locked_until and user.locked_until > _now():
        remaining = int((user.locked_until - _now()).total_seconds())
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"Account locked. Try again in {remaining}s")


def _token_for(user: User) -> str:
    return create_access_token(user_id=user.id, email=user.email, phone=user.phone, role=UserRole(user.role))


def _auth_response(user: User) -> AuthOut:
    return AuthOut(token=_token_for(user), user=UserOut.model_validate(user))


# ─── Email + password (May's app) ────────────────────────────────────────────


async def register_with_password(db: AsyncSession, dto: RegisterIn) -> AuthOut:
    email = dto.email.lower()
    existing = await db.scalar(select(User).where(User.email == email))
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")

    user = User(
        name=dto.name,
        email=email,
        password_hash=hash_password(dto.password),
        phone=dto.phone,
        city=dto.city,
        age=dto.age,
        license_year=dto.license_year,
        last_logged_at=_now(),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    audit("auth.registered", user_id=user.id, via="email")
    return _auth_response(user)


async def login_with_password(db: AsyncSession, dto: LoginIn) -> AuthOut:
    user = await db.scalar(select(User).where(User.email == dto.email.lower()))
    if user is None or not user.password_hash:
        audit("auth.login.failure", email_hint=hash_email(dto.email), reason="no_user")
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")
    _assert_not_locked(user)
    if not verify_password(dto.password, user.password_hash):
        audit("auth.login.failure", user_id=user.id, email_hint=hash_email(dto.email), reason="bad_password")
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")

    user.last_logged_at = _now()
    await db.commit()
    await db.refresh(user)
    audit("auth.login.success", user_id=user.id, via="email")
    return _auth_response(user)


# ─── Phone + OTP (spec 4.2.1) ────────────────────────────────────────────────


async def _assert_otp_quota(db: AsyncSession, phone: str) -> None:
    """Cap the codes a single phone number can trigger in an hour.

    The per-route limit in the router is keyed on the caller's IP, which is one
    proxy away from useless. This is keyed on the thing that actually costs
    money — every code is a billed SMS, so the destination number is the budget
    line, and it stays the same however many addresses the caller rotates
    through. Counts registration and login codes together, because both send.
    """
    since = _now() - timedelta(hours=1)
    recent = await db.scalar(
        select(func.count()).select_from(OtpCode).where(OtpCode.phone == phone, OtpCode.created_at >= since)
    )
    if (recent or 0) >= settings.otp_max_per_hour:
        audit("auth.otp.throttled", phone_masked=mask_phone(phone), sent_last_hour=recent)
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Too many verification codes requested for this number. Try again later.",
        )


async def _issue_otp(db: AsyncSession, phone: str) -> OtpSent:
    await _assert_otp_quota(db, phone)
    code = random_digits(settings.otp_length)
    expires_at = _now() + timedelta(seconds=settings.otp_ttl_seconds)

    # invalidate previous unconsumed OTPs for this phone+purpose
    await db.execute(
        update(OtpCode)
        .where(OtpCode.phone == phone, OtpCode.purpose == OTP_PURPOSE, OtpCode.consumed_at.is_(None))
        .values(consumed_at=_now())
    )
    db.add(OtpCode(phone=phone, code_hash=hash_code(code), expires_at=expires_at, purpose=OTP_PURPOSE))
    await db.commit()

    minutes = round(settings.otp_ttl_seconds / 60)
    await sms_sender.send(phone, f"CARMA: קוד האימות שלך הוא {code}. תוקף ל-{minutes} דקות.")

    if settings.env != "production":
        log.debug("[dev-otp] phone=%s code=%s", phone, code)

    audit("auth.otp.issued", phone_masked=mask_phone(phone), purpose=OTP_PURPOSE, ttl=settings.otp_ttl_seconds)
    return OtpSent(message="OTP sent", expires_in_seconds=settings.otp_ttl_seconds)


async def register_with_otp(db: AsyncSession, dto: OtpRegisterIn) -> OtpSent:
    existing = await db.scalar(select(User).where(User.phone == dto.phone))
    if existing and existing.is_phone_verified:
        raise HTTPException(status.HTTP_409_CONFLICT, "A verified user with this phone already exists")

    if existing:
        existing.name = dto.name
        existing.language = dto.language or Language.HE
        existing.age = dto.age
        existing.city = dto.city
    else:
        db.add(
            User(
                phone=dto.phone,
                name=dto.name,
                language=dto.language or Language.HE,
                age=dto.age,
                city=dto.city,
            )
        )
    await db.commit()
    return await _issue_otp(db, dto.phone)


async def request_login_otp(db: AsyncSession, phone: str) -> OtpSent:
    user = await db.scalar(select(User).where(User.phone == phone))
    if user is None:
        # don't leak account existence — same shape, no SMS
        return OtpSent(
            message="If the phone is registered an OTP has been sent", expires_in_seconds=settings.otp_ttl_seconds
        )
    _assert_not_locked(user)
    return await _issue_otp(db, phone)


def _rejected(phone: str, reason: str, user: User | None = None) -> HTTPException:
    """Log precisely, answer vaguely.

    The audit trail keeps the distinction so an operator can still tell an
    unknown number from an expired code; the response does not.
    """
    audit("auth.otp.failure", user_id=user.id if user else None, phone_masked=mask_phone(phone), reason=reason)
    return HTTPException(status.HTTP_401_UNAUTHORIZED, OTP_REJECTED)


async def verify_otp(db: AsyncSession, dto: OtpVerifyIn) -> AuthOut:
    user = await db.scalar(select(User).where(User.phone == dto.phone))
    if user is None:
        raise _rejected(dto.phone, "no_user")
    # A locked account answers like every other failure here. The lockout is
    # explained on `otp/request`, where the caller is the account's owner —
    # saying it here would make five wrong guesses a test for "is this number
    # registered?".
    if user.locked_until and user.locked_until > _now():
        raise _rejected(dto.phone, "locked", user)

    otp = await db.scalar(
        select(OtpCode)
        .where(OtpCode.phone == dto.phone, OtpCode.purpose == OTP_PURPOSE, OtpCode.consumed_at.is_(None))
        .order_by(OtpCode.created_at.desc())
    )
    if otp is None:
        raise _rejected(dto.phone, "no_active_otp", user)
    if otp.expires_at < _now():
        raise _rejected(dto.phone, "expired", user)

    if not verify_code(dto.code, otp.code_hash):
        otp.attempts += 1
        await _record_failure(db, user)
        raise _rejected(dto.phone, "bad_code", user)

    otp.consumed_at = _now()
    user.is_phone_verified = True
    user.failed_otp_count = 0
    user.locked_until = None
    user.last_logged_at = _now()
    await db.commit()
    await db.refresh(user)
    audit("auth.otp.success", user_id=user.id)
    return _auth_response(user)


async def _record_failure(db: AsyncSession, user: User) -> None:
    user.failed_otp_count += 1
    if user.failed_otp_count >= settings.otp_max_attempts:
        user.locked_until = _now() + timedelta(seconds=settings.otp_lockout_seconds)
        user.failed_otp_count = 0
        audit("auth.lockout", user_id=user.id, lockout_until=user.locked_until.isoformat())
    await db.commit()
