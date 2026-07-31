from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import delete, func, select, update
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
from app.models import Language, LoginFailure, OtpCode, User, UserRole
from app.schemas.auth import AuthOut, LoginIn, OtpRegisterIn, OtpSent, OtpVerifyIn, RegisterIn
from app.services import users as users_service
from app.services.sms import sms_sender

log = logging.getLogger(__name__)

OTP_PURPOSE = "LOGIN"

# One answer for every way an OTP can fail to let you in. A different status or
# wording for "no such phone" turns this endpoint into a directory of who has a
# CARMA account — which `request_login_otp` already goes out of its way to hide.
# The caller's next move is the same in every case: ask for a new code.
OTP_REJECTED = "Invalid or expired code — request a new one"

# The same idea one door over: every way password login can fail answers alike.
LOGIN_REJECTED = "Invalid email or password"


def _now() -> datetime:
    return datetime.now(UTC)


def _assert_not_locked(user: User) -> None:
    """Answer a locked account exactly like a wrong password.

    A distinct 403 here made six requests enough to tell a registered email from
    an unknown one: guess wrong five times, then read the reply. The lockout
    itself is unchanged — the right password still does not open the account —
    it just no longer announces that the account exists. The audit log keeps the
    distinction so an operator can still see why a caller was turned away.
    """
    if user.locked_until and user.locked_until > _now():
        audit("auth.login.failure", user_id=user.id, reason="locked")
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, LOGIN_REJECTED)


def _backoff_seconds(failures: int) -> int:
    """What a caller owes after `failures` misses: nothing, then a second, doubling."""
    over = failures - settings.login_backoff_after
    if over < 0:
        return 0
    # Clamp the shift before taking it. `failures` is bounded only by the
    # account-wide ceiling, and 1 << 95 is a large number to build and discard.
    return min(1 << min(over, 20), settings.login_backoff_max_seconds)


async def _backoff_active(db: AsyncSession, user_id: str, caller_ip: str) -> bool:
    """True while this address is still serving out its wait on this account.

    Counted per (account, address) rather than per account, which is the whole
    point: a wait keyed on the account alone is something a stranger can inflict
    on its owner. See `models.login_failure.LoginFailure`.
    """
    since = _now() - timedelta(seconds=settings.login_failure_window_seconds)
    row = (
        await db.execute(
            select(func.count(), func.max(LoginFailure.created_at)).where(
                LoginFailure.user_id == user_id,
                LoginFailure.caller_ip == caller_ip,
                LoginFailure.created_at >= since,
            )
        )
    ).one()
    failures: int = row[0]
    last: datetime | None = row[1]
    if last is None:
        return False
    return last + timedelta(seconds=_backoff_seconds(failures)) > _now()


async def _clear_failures(db: AsyncSession, user_id: str, caller_ip: str) -> None:
    """A correct credential proves whoever is at *this* address owns the account.

    Scoped to the address deliberately: clearing every address would hand a
    guesser a clean slate each time the real owner signed in.
    """
    await db.execute(delete(LoginFailure).where(LoginFailure.user_id == user_id, LoginFailure.caller_ip == caller_ip))


def _token_for(user: User) -> str:
    return create_access_token(user_id=user.id, email=user.email, phone=user.phone, role=UserRole(user.role))


async def _auth_response(db: AsyncSession, user: User) -> AuthOut:
    return AuthOut(token=_token_for(user), user=await users_service.profile_out(db, user))


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
    return await _auth_response(db, user)


async def login_with_password(db: AsyncSession, dto: LoginIn, caller_ip: str) -> AuthOut:
    user = await db.scalar(select(User).where(User.email == dto.email.lower()))
    if user is None or not user.password_hash:
        audit("auth.login.failure", email_hint=hash_email(dto.email), reason="no_user")
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, LOGIN_REJECTED)
    _assert_not_locked(user)
    if await _backoff_active(db, user.id, caller_ip):
        # Refused before bcrypt, with the identical 401 a wrong password gets. A
        # 429 or a Retry-After would re-open the oracle #64 closed; sleeping out
        # the wait would hold a pooled connection, and fifteen of those stop the
        # API for everyone — the same attack, self-inflicted.
        audit("auth.login.failure", user_id=user.id, email_hint=hash_email(dto.email), reason="caller_backoff")
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, LOGIN_REJECTED)
    if not verify_password(dto.password, user.password_hash):
        audit("auth.login.failure", user_id=user.id, email_hint=hash_email(dto.email), reason="bad_password")
        await _record_failure(db, user, caller_ip)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, LOGIN_REJECTED)

    await _clear_failures(db, user.id, caller_ip)
    user.last_logged_at = _now()
    await db.commit()
    await db.refresh(user)
    audit("auth.login.success", user_id=user.id, via="email")
    return await _auth_response(db, user)


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

    # Check the quota before writing, not inside `_issue_otp` after. A caller who
    # is over their hourly cap should change nothing: otherwise the 429 still
    # leaves the profile fields of an unverified account rewritten, over and over.
    await _assert_otp_quota(db, dto.phone)

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


_OTP_SENT_OR_NOT = "If the phone is registered an OTP has been sent"


async def request_login_otp(db: AsyncSession, phone: str) -> OtpSent:
    user = await db.scalar(select(User).where(User.phone == phone))

    # Unknown number and locked account answer identically, and neither sends an
    # SMS. An earlier version explained the lockout here, reasoning that whoever
    # asks for a code holds the number anyway. That does not hold for someone
    # probing numbers they do not own: a lockout is something an attacker can
    # *cause* (five wrong codes), so a distinct answer turns it into a test for
    # "is this number registered?". The locked user still learns why on verify.
    if user is None or (user.locked_until and user.locked_until > _now()):
        return OtpSent(message=_OTP_SENT_OR_NOT, expires_in_seconds=settings.otp_ttl_seconds)

    return await _issue_otp(db, phone)


def _rejected(phone: str, reason: str, user: User | None = None) -> HTTPException:
    """Log precisely, answer vaguely.

    The audit trail keeps the distinction so an operator can still tell an
    unknown number from an expired code; the response does not.
    """
    audit("auth.otp.failure", user_id=user.id if user else None, phone_masked=mask_phone(phone), reason=reason)
    return HTTPException(status.HTTP_401_UNAUTHORIZED, OTP_REJECTED)


async def verify_otp(db: AsyncSession, dto: OtpVerifyIn, caller_ip: str) -> AuthOut:
    user = await db.scalar(select(User).where(User.phone == dto.phone))
    if user is None:
        raise _rejected(dto.phone, "no_user")
    # A locked account answers like every other failure here. The lockout is
    # explained on `otp/request`, where the caller is the account's owner —
    # saying it here would make five wrong guesses a test for "is this number
    # registered?".
    if user.locked_until and user.locked_until > _now():
        raise _rejected(dto.phone, "locked", user)
    if await _backoff_active(db, user.id, caller_ip):
        raise _rejected(dto.phone, "caller_backoff", user)

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
        await _record_failure(db, user, caller_ip)
        raise _rejected(dto.phone, "bad_code", user)

    otp.consumed_at = _now()
    user.is_phone_verified = True
    await _clear_failures(db, user.id, caller_ip)
    user.locked_until = None
    user.last_logged_at = _now()
    await db.commit()
    await db.refresh(user)
    audit("auth.otp.success", user_id=user.id)
    return await _auth_response(db, user)


async def _record_failure(db: AsyncSession, user: User, caller_ip: str) -> None:
    """Bank a failed sign-in against the caller, and against the account as a backstop.

    Called from both doors — wrong password and wrong code. `locked_until` shuts
    the account to everyone, including whoever holds a valid session
    (`core.deps.current_user`), so it is set at NIST's maximum rather than at a
    number a stranger can reach cheaply.

    Commits, because the caller raises a 401 immediately after and a discarded
    session would throw the failure away.
    """
    since = _now() - timedelta(seconds=settings.login_failure_window_seconds)
    db.add(LoginFailure(user_id=user.id, caller_ip=caller_ip))
    # Nothing runs on a timer in this project, so rows are swept on the next
    # failure for the same account — a write we are making anyway, narrowed so it
    # never scans the table. Same lazy shape as `rewards.expire_overdue`.
    await db.execute(delete(LoginFailure).where(LoginFailure.user_id == user.id, LoginFailure.created_at < since))
    account_failures = await db.scalar(
        select(func.count())
        .select_from(LoginFailure)
        .where(LoginFailure.user_id == user.id, LoginFailure.created_at >= since)
    )
    if (account_failures or 0) >= settings.account_lockout_after:
        user.locked_until = _now() + timedelta(seconds=settings.otp_lockout_seconds)
        # Clear the slate the counter column used to get on lockout, so the
        # account does not re-lock on the first failure after it reopens.
        await db.execute(delete(LoginFailure).where(LoginFailure.user_id == user.id))
        audit("auth.lockout", user_id=user.id, lockout_until=user.locked_until.isoformat())
    await db.commit()
