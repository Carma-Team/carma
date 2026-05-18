from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import select, update
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


async def _issue_otp(db: AsyncSession, phone: str) -> OtpSent:
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


async def verify_otp(db: AsyncSession, dto: OtpVerifyIn) -> AuthOut:
    user = await db.scalar(select(User).where(User.phone == dto.phone))
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No user with this phone")
    _assert_not_locked(user)

    otp = await db.scalar(
        select(OtpCode)
        .where(OtpCode.phone == dto.phone, OtpCode.purpose == OTP_PURPOSE, OtpCode.consumed_at.is_(None))
        .order_by(OtpCode.created_at.desc())
    )
    if otp is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No active OTP — request a new one")
    if otp.expires_at < _now():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "OTP expired — request a new one")

    if not verify_code(dto.code, otp.code_hash):
        otp.attempts += 1
        await _record_failure(db, user)
        audit("auth.otp.failure", user_id=user.id, attempts=user.failed_otp_count)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect OTP")

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
