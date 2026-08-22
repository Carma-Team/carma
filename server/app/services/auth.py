from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import HTTPException, Request, Response, status
from sqlalchemy import CursorResult, delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.audit import audit, hash_email, mask_phone
from app.core.security import (
    create_access_token,
    hash_code,
    hash_password,
    hash_refresh_token,
    random_digits,
    random_refresh_token,
    verify_code,
    verify_password,
)
from app.models import Language, LoginFailure, OtpCode, RefreshToken, User, UserRole
from app.schemas.auth import (
    AuthOut,
    LoginIn,
    MessageOut,
    OtpRegisterIn,
    OtpSent,
    OtpVerifyIn,
    PasswordResetIn,
    RegisterIn,
)
from app.services import users as users_service
from app.services.sms import sms_sender

log = logging.getLogger(__name__)

OTP_PURPOSE = "LOGIN"
# A reset code is a second, separate credential, not a login code wearing a hat.
# Kept apart so that asking to reset does not cancel a login code the driver is
# already typing, and so a code phished for one door cannot open the other.
RESET_PURPOSE = "PASSWORD_RESET"

# One answer for every way an OTP can fail to let you in. A different status or
# wording for "no such phone" turns this endpoint into a directory of who has a
# CARMA account — which `request_login_otp` already goes out of its way to hide.
# The caller's next move is the same in every case: ask for a new code.
OTP_REJECTED = "Invalid or expired code — request a new one"

# The same idea one door over: every way password login can fail answers alike.
LOGIN_REJECTED = "Invalid email or password"

_LOGIN_SMS = "CARMA: קוד האימות שלך הוא {code}. תוקף ל-{minutes} דקות."
# The reset code names what it opens. A driver who did not ask for one needs to
# know from the message alone that somebody is trying to take their password —
# an identical "your verification code" would read as a login they mistyped.
_RESET_SMS = "CARMA: קוד לאיפוס הסיסמה שלך הוא {code}. תוקף ל-{minutes} דקות. אם לא ביקשת, התעלם."


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


async def _sweep_expired(db: AsyncSession, since: datetime) -> None:
    """Drop failures too old to mean anything, wherever they are.

    Nothing runs on a timer in this project, so this rides along with writes we
    are making anyway — the same lazy shape as `rewards.expire_overdue`. It is
    deliberately *not* narrowed to one account: these rows hold IP addresses,
    which are personal data, and an account that stops being attacked would
    otherwise keep the attacker's addresses forever. Past the window they have no
    purpose left, so they should not exist.
    """
    await db.execute(delete(LoginFailure).where(LoginFailure.created_at < since))


async def _clear_failures(db: AsyncSession, user: User, caller_ip: str) -> None:
    """A correct credential proves whoever is at *this* address owns the account.

    Two different clears, and they must not be confused. The *rows* go only for
    this address — dropping every address would hand a guesser a clean slate each
    time the real owner signed in. The *account-wide tally* restarts for everyone,
    because NIST SP 800-63B §5.2.2 says a success disregards prior failures, and
    without it the march to `account_lockout_after` never rewinds: a driver who
    signs in daily still ends up locked by someone else's patient guessing.
    """
    await db.execute(delete(LoginFailure).where(LoginFailure.user_id == user.id, LoginFailure.caller_ip == caller_ip))
    user.lockout_reset_at = _now()
    await _sweep_expired(db, _now() - timedelta(seconds=settings.login_failure_window_seconds))


def _token_for(user: User, *, expires_minutes: int | None = None) -> str:
    return create_access_token(
        user_id=user.id, email=user.email, phone=user.phone, role=UserRole(user.role), expires_minutes=expires_minutes
    )


async def _auth_response(db: AsyncSession, user: User, *, expires_minutes: int | None = None) -> AuthOut:
    token = _token_for(user, expires_minutes=expires_minutes)
    return AuthOut(token=token, user=await users_service.profile_out(db, user))


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


async def login_with_password(
    db: AsyncSession, dto: LoginIn, caller_ip: str, response: Response, *, is_browser: bool = False
) -> AuthOut:
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

    await _clear_failures(db, user, caller_ip)
    user.last_logged_at = _now()
    await _sweep_expired_refresh_tokens(db)
    # Every successful email+password login mints one of these, mobile calls
    # included — the row is a few bytes and the lazy sweep above bounds the
    # table regardless of who never comes back to spend it. Unconditional for
    # the same reason: mobile already ignores `Set-Cookie`, so the cookie is
    # inert for it either way. The *access token's* lifetime is the one thing
    # that does branch — see below — because unlike the cookie, mobile reads
    # and uses that value, so it cannot be shortened for everyone.
    raw_refresh = _mint_refresh_token(db, user)
    await db.commit()
    await db.refresh(user)
    _set_refresh_cookie(response, raw_refresh)
    audit("auth.login.success", user_id=user.id, via="email")
    # `is_browser` is `X-Requested-With: XMLHttpRequest` — CARMA's web app
    # sends it on every call (see `lib/auth/authApi.ts`), mobile never has.
    # Web's very first access token is short-lived from this response, not
    # just from the first `/refresh` — a 7-day bearer token that happened to
    # leave the wire once is still a 7-day bearer token no matter how fast
    # the tab that received it moves on from it; the token's own lifetime is
    # what actually bounds that, so it has to be short from the start.
    # Mobile's request never carries the header, so `expires_minutes` stays
    # `None` and it keeps exactly `JWT_EXPIRES_MINUTES`, unchanged.
    expires_minutes = settings.web_access_token_expires_minutes if is_browser else None
    return await _auth_response(db, user, expires_minutes=expires_minutes)


# ─── Web session — refresh cookie (CAR-217) ──────────────────────────────────

REFRESH_COOKIE_NAME = "carma_refresh"
# Scoped to the auth routes rather than "/": nothing else on the API ever
# needs to read this cookie, and narrowing the path is free hardening — every
# other request the browser makes simply never carries it.
REFRESH_COOKIE_PATH = "/api/auth"

REFRESH_REJECTED = "Session expired — sign in again"

# Two tabs open on the same session can both read the cookie before either's
# refresh lands, and then both present the same not-yet-rotated value. One of
# them loses the race — the row it presents is revoked by the winner a
# heartbeat earlier. This is how long that loser has to be recognised as
# "the same session, a moment late" rather than "a dead token, replayed".
# Long enough for real request latency and a retry; short enough that it
# buys an actual attacker nothing — replaying a genuinely stolen token still
# has to land inside this window of the legitimate rotation to slip through,
# and it still only inherits the session that legitimate rotation produced.
REUSE_GRACE_SECONDS = 10


def _mint_refresh_token(db: AsyncSession, user: User) -> str:
    """A brand-new row with no predecessor — login's case, not a rotation's.
    `_try_rotate` is the atomic claim-and-mint used everywhere a row is being
    *replaced*; this is the plain insert used the one time there is nothing
    yet to replace."""
    raw = random_refresh_token()
    expires_at = _now() + timedelta(days=settings.refresh_token_expires_days)
    db.add(RefreshToken(user_id=user.id, token_hash=hash_refresh_token(raw), expires_at=expires_at))
    return raw


async def _try_rotate(db: AsyncSession, row: RefreshToken) -> tuple[User, str] | None:
    """Atomically claim `row` and mint its successor — the fix for a gap a
    plain "read, check, then write" rotation has: two requests presenting the
    same not-yet-rotated token can both read `revoked_at IS NULL` before
    either commits, and a read-then-write rotation lets *both* mint their own
    child. That is fine when both requesters are the same legitimate session
    (see `REUSE_GRACE_SECONDS`) — it is not fine when one of them is whoever
    is holding a stolen copy of `row`: two independent children never
    intersect again, so no future use of either one would ever reveal the
    theft.

    The `WHERE revoked_at IS NULL` here is what closes that: Postgres can
    only let one concurrent `UPDATE` match a given row, so at most one caller
    ever gets a non-zero `rowcount` back, no matter how many callers read the
    row as unrevoked first. The loser (`None`) is not told "you lose" — the
    caller (`refresh_session`) routes it through the exact same grace-window
    check a token that was *already* revoked when read goes through, so the
    two cases share one answer.

    The child is inserted (and flushed) *before* the claim, not after — the
    claim's `replaced_by_id` has to point at a row that already exists, the
    same foreign-key ordering `login_with_password` doesn't have to think
    about because it has no predecessor to point from. Losing the claim
    leaves that child orphaned: nobody was ever handed its raw value, so it
    can never be presented, and it is as harmless as any other unclaimed row
    until the sweep clears it.
    """
    user = await db.get(User, row.user_id)
    if user is None:
        return None
    raw = random_refresh_token()
    new_id = uuid.uuid4().hex
    expires_at = _now() + timedelta(days=settings.refresh_token_expires_days)
    db.add(RefreshToken(id=new_id, user_id=user.id, token_hash=hash_refresh_token(raw), expires_at=expires_at))
    await db.flush()

    # `execute` is typed as returning a plain Result, which has no rowcount.
    # A DML statement always yields a CursorResult at runtime — the annotation
    # tells mypy that, it does not change behaviour. Same pattern as rewards.py.
    claim: CursorResult[Any] = await db.execute(  # type: ignore[assignment]
        update(RefreshToken)
        .where(RefreshToken.id == row.id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=_now(), replaced_by_id=new_id)
    )
    if claim.rowcount == 0:
        return None
    return user, raw


async def _sweep_expired_refresh_tokens(db: AsyncSession) -> None:
    """Same shape as `_sweep_expired` for `LoginFailure`: no job runs on a timer,
    so this rides along with a write already happening on the table."""
    await db.execute(delete(RefreshToken).where(RefreshToken.expires_at < _now()))


def _set_refresh_cookie(response: Response, raw: str) -> None:
    response.set_cookie(
        REFRESH_COOKIE_NAME,
        raw,
        max_age=settings.refresh_token_expires_days * 86400,
        path=REFRESH_COOKIE_PATH,
        httponly=True,
        secure=settings.refresh_cookie_secure,
        samesite=settings.refresh_cookie_samesite,
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(REFRESH_COOKIE_NAME, path=REFRESH_COOKIE_PATH)


async def _rotated_response(db: AsyncSession, user: User, new_raw: str, response: Response, *, event: str) -> AuthOut:
    await _sweep_expired_refresh_tokens(db)
    await db.commit()
    _set_refresh_cookie(response, new_raw)
    audit(event, user_id=user.id)
    return AuthOut(
        token=_token_for(user, expires_minutes=settings.web_access_token_expires_minutes),
        user=await users_service.profile_out(db, user),
    )


async def refresh_session(db: AsyncSession, request: Request, response: Response) -> AuthOut:
    """Trade the httpOnly cookie for a fresh, short-lived access token.

    Rotates on every call, via `_try_rotate`'s atomic claim: the presented
    row is good for exactly one silent renewal, the same shape a stolen
    *access* token already has from `web_access_token_expires_minutes`, just
    on the cookie's clock instead.

    A row that is already revoked when read, or that loses the atomic claim
    on this very call, usually means reuse — the row was (or just was)
    replayed after something else already moved the session past it — and
    every other live session on the account is cut, rather than guessing
    which copy is legitimate. The one exception is `REUSE_GRACE_SECONDS`, and
    it reaches exactly one hop: two tabs open on the same session can both
    read the cookie before either's refresh lands, so the loser's row has
    exactly one legitimate successor — its `replaced_by_id` — and that row
    still being claimable is what tells this apart from an actual replay.
    Claiming the successor is itself atomic for the same reason claiming the
    original token is: a *third* racer (a stolen token replayed inside the
    same instant as two legitimate tabs, or as this recovery itself) must not
    be able to mint its own independent child either — see `_try_rotate`.
    A successor that is already revoked when checked means the chain has
    moved two rotations past whatever was presented — that is no longer "two
    tabs, one instant," it is a token from further back, and it is cut like
    any other reuse. This is deliberately not a walk to wherever the chain
    currently ends: an old token does not get to ride every rotation since it
    died back onto the grace window.
    """
    raw = request.cookies.get(REFRESH_COOKIE_NAME)
    if not raw:
        _clear_refresh_cookie(response)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, REFRESH_REJECTED)

    row = await db.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(raw)))

    if row is None or row.expires_at < _now():
        _clear_refresh_cookie(response)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, REFRESH_REJECTED)

    if row.revoked_at is None:
        claimed = await _try_rotate(db, row)
        if claimed is not None:
            user, new_raw = claimed
            return await _rotated_response(db, user, new_raw, response, event="auth.refresh.success")
        # Lost the atomic claim: someone else's request revoked this row
        # between our SELECT above and the UPDATE inside `_try_rotate` —
        # `row`'s own attributes are now stale in memory (this session never
        # committed the change that made them so) and have to be re-read
        # before anything below can trust `revoked_at`/`replaced_by_id`.
        await db.refresh(row)

    if row.revoked_at is not None:
        within_grace = row.replaced_by_id is not None and _now() - row.revoked_at < timedelta(
            seconds=REUSE_GRACE_SECONDS
        )
        successor = await db.get(RefreshToken, row.replaced_by_id) if within_grace else None
        if successor is not None and successor.revoked_at is None and successor.expires_at > _now():
            claimed = await _try_rotate(db, successor)
            if claimed is not None:
                user, new_raw = claimed
                return await _rotated_response(db, user, new_raw, response, event="auth.refresh.grace_window_race")

    await db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == row.user_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=_now())
    )
    await db.commit()
    audit("auth.refresh.reuse_detected", user_id=row.user_id)
    _clear_refresh_cookie(response)
    raise HTTPException(status.HTTP_401_UNAUTHORIZED, REFRESH_REJECTED)


async def logout_session(db: AsyncSession, request: Request, response: Response) -> MessageOut:
    """End the session the cookie names, then clear the cookie regardless.

    Works with no access token at all — logging out is exactly what a browser
    with a broken or expired one still needs to be able to do. Idempotent: no
    cookie, an unknown one, or one already revoked all answer the same way.
    """
    raw = request.cookies.get(REFRESH_COOKIE_NAME)
    if raw:
        row = await db.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(raw)))
        if row is not None and row.revoked_at is None:
            row.revoked_at = _now()
            await db.commit()
            audit("auth.logout", user_id=row.user_id)
    _clear_refresh_cookie(response)
    return MessageOut(message="Signed out")


# ─── Phone + OTP (spec 4.2.1) ────────────────────────────────────────────────


async def _over_otp_quota(db: AsyncSession, phone: str) -> bool:
    """Whether this number has already had its hour's worth of codes.

    The per-route limit in the router is keyed on the caller's IP, which is one
    proxy away from useless. This is keyed on the thing that actually costs
    money — every code is a billed SMS, so the destination number is the budget
    line, and it stays the same however many addresses the caller rotates
    through. Counts registration, login and reset codes together: all three send.

    Returns rather than raises, because only a number we have an account for can
    ever reach the cap — an unregistered one writes no rows to count. A 429 was
    therefore the answer to "does this number have a CARMA account?", six requests
    away from anyone who asked. The two request routes now spend it in silence;
    the audit line is where an operator still sees it.
    """
    since = _now() - timedelta(hours=1)
    recent = await db.scalar(
        select(func.count()).select_from(OtpCode).where(OtpCode.phone == phone, OtpCode.created_at >= since)
    )
    if (recent or 0) >= settings.otp_max_per_hour:
        audit("auth.otp.throttled", phone_masked=mask_phone(phone), sent_last_hour=recent)
        return True
    return False


async def _assert_otp_quota(db: AsyncSession, phone: str) -> None:
    """The same cap said out loud — for registration, where it gives nothing away.

    `otp/register` already answers a number that is taken with a 409, so a caller
    who reaches the cap there learns nothing they could not have asked for
    directly. A driver signing up also needs to be told why no code arrived.
    """
    if await _over_otp_quota(db, phone):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Too many verification codes requested for this number. Try again later.",
        )


async def _issue_otp(db: AsyncSession, phone: str, purpose: str = OTP_PURPOSE) -> OtpSent:
    """Mint a code, store it, send it. The caller owns the quota check.

    Deliberately not checked in here: over the cap, the request routes have to
    carry on and answer exactly as though a code went out, which a helper that
    raises from underneath them cannot do.
    """
    code = random_digits(settings.otp_length)
    expires_at = _now() + timedelta(seconds=settings.otp_ttl_seconds)

    # invalidate previous unconsumed OTPs for this phone+purpose
    await db.execute(
        update(OtpCode)
        .where(OtpCode.phone == phone, OtpCode.purpose == purpose, OtpCode.consumed_at.is_(None))
        .values(consumed_at=_now())
    )
    db.add(OtpCode(phone=phone, code_hash=hash_code(code), expires_at=expires_at, purpose=purpose))
    await db.commit()

    minutes = round(settings.otp_ttl_seconds / 60)
    body = _RESET_SMS if purpose == RESET_PURPOSE else _LOGIN_SMS
    await sms_sender.send(phone, body.format(code=code, minutes=minutes))

    if settings.env != "production":
        log.debug("[dev-otp] phone=%s purpose=%s code=%s", phone, purpose, code)

    audit("auth.otp.issued", phone_masked=mask_phone(phone), purpose=purpose, ttl=settings.otp_ttl_seconds)
    return OtpSent(message="OTP sent", expires_in_seconds=settings.otp_ttl_seconds)


async def register_with_otp(db: AsyncSession, dto: OtpRegisterIn) -> OtpSent:
    existing = await db.scalar(select(User).where(User.phone == dto.phone))
    if existing and existing.is_phone_verified:
        raise HTTPException(status.HTTP_409_CONFLICT, "A verified user with this phone already exists")

    # Check the quota before writing the profile below, not after. A caller who is
    # over their hourly cap should change nothing: otherwise the 429 still leaves
    # the profile fields of an unverified account rewritten, over and over.
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


def _sent_or_not() -> OtpSent:
    """The one answer both request routes give, code sent or not.

    `_issue_otp` returns "OTP sent", which is true but is also the tell: a caller
    comparing that against `_OTP_SENT_OR_NOT` reads straight off which numbers
    are registered, which is the whole thing the branches below exist to hide.
    """
    return OtpSent(message=_OTP_SENT_OR_NOT, expires_in_seconds=settings.otp_ttl_seconds)


async def request_login_otp(db: AsyncSession, phone: str) -> OtpSent:
    user = await db.scalar(select(User).where(User.phone == phone))
    locked = user is not None and user.locked_until is not None and user.locked_until > _now()

    # Unknown number, locked account and a number over its hourly cap all answer
    # identically, and none of the three sends an SMS. An earlier version
    # explained the lockout here, reasoning that whoever asks for a code holds the
    # number anyway. That does not hold for someone probing numbers they do not
    # own: a lockout is something an attacker can *cause* (five wrong codes), so a
    # distinct answer turns it into a test for "is this number registered?". The
    # locked user still learns why on verify. The cap is the same trap one step
    # further along — see `_over_otp_quota`.
    if user is not None and not locked and not await _over_otp_quota(db, phone):
        await _issue_otp(db, phone)

    return _sent_or_not()


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
    await _clear_failures(db, user, caller_ip)
    user.locked_until = None
    user.last_logged_at = _now()
    await db.commit()
    await db.refresh(user)
    audit("auth.otp.success", user_id=user.id)
    return await _auth_response(db, user)


# ─── Forgotten password (CAR-60) ─────────────────────────────────────────────


async def _driver_by_phone(db: AsyncSession, phone: str) -> User | None:
    """Find the account behind an E.164 number, however its phone was typed in.

    `register_with_password` accepts free-form input and stores it as typed, so an
    email account's number is as likely to read `0501234567` as `+972501234567` —
    `users.phone_candidates` is here for that exact split, and search already uses
    it. An `==` match would answer "a code has been sent" to precisely the drivers
    this endpoint exists for, and never send one.

    Ordered, because both spellings can sit in the table at once: `users.phone` is
    unique per string, not per number. The older row wins so the answer cannot
    change under a driver who signs up again.
    """
    candidates = users_service.phone_candidates(phone)
    if not candidates:
        return None
    found: User | None = await db.scalar(select(User).where(User.phone.in_(candidates)).order_by(User.created_at))
    return found


def _has_password_login(user: User) -> bool:
    """Whether a new password would be usable at all.

    `login_with_password` finds the account by email, and a driver who signed up
    by phone has none. Minting them a password answers "sign in with your new
    password" and sends them to a screen with nowhere to type it — worse than
    refusing, because it looks like it worked. Their way back in is `otp/request`,
    which needs no password. CAR-37 is where an account stops being one row with
    one credential; the check belongs there when it lands.
    """
    return user.email is not None


async def request_password_reset(db: AsyncSession, phone: str) -> OtpSent:
    """Send a reset code, and send it to locked accounts too.

    This is where the reset door deliberately parts company with `otp/request`,
    which stays silent for a locked account. Being locked out is the most likely
    reason somebody is here at all — a hundred wrong passwords is exactly how a
    driver who forgot theirs spends the minute before giving up. Refusing them a
    code would leave the lockout with no exit but waiting, which is the hole this
    endpoint was opened to close.

    Nothing leaks by sending it: the answer is `_sent_or_not()` either way, and a
    caller who does not hold the number never sees the code.
    """
    user = await _driver_by_phone(db, phone)
    if user is not None and _has_password_login(user) and not await _over_otp_quota(db, phone):
        await _issue_otp(db, phone, RESET_PURPOSE)

    return _sent_or_not()


async def reset_password(db: AsyncSession, dto: PasswordResetIn, caller_ip: str) -> MessageOut:
    """Trade a valid reset code for a new password, and for the account back.

    Every rejection answers with `OTP_REJECTED`, the same string `otp/verify`
    uses — an unknown number, a stale code and a wrong digit are one reply here.
    """
    user = await _driver_by_phone(db, dto.phone)
    if user is None:
        raise _rejected(dto.phone, "no_user")
    # Checked on both halves. `request_password_reset` will not have issued a code
    # for an account like this, but a code issued before it grew the check — or
    # before an email was ever removed — must not still be spendable.
    if not _has_password_login(user):
        raise _rejected(dto.phone, "no_password_login", user)
    # No lockout check, unlike `verify_otp`. A locked account is the case this path
    # is for; see `request_password_reset`. Be honest about what that costs: the
    # per-address backoff below still slows one guesser down, but the account-wide
    # ceiling that eventually shuts `verify_otp` cannot fire here, and nothing in
    # the codebase reads `otp.attempts`. Six digits and a five-minute window are
    # the whole defence against somebody rotating addresses.
    if await _backoff_active(db, user.id, caller_ip):
        raise _rejected(dto.phone, "caller_backoff", user)

    otp = await db.scalar(
        select(OtpCode)
        .where(OtpCode.phone == dto.phone, OtpCode.purpose == RESET_PURPOSE, OtpCode.consumed_at.is_(None))
        .order_by(OtpCode.created_at.desc())
    )
    if otp is None:
        raise _rejected(dto.phone, "no_active_reset_otp", user)
    if otp.expires_at < _now():
        raise _rejected(dto.phone, "expired", user)

    if not verify_code(dto.code, otp.code_hash):
        otp.attempts += 1
        await _record_failure(db, user, caller_ip)
        raise _rejected(dto.phone, "bad_reset_code", user)

    otp.consumed_at = _now()
    user.password_hash = hash_password(dto.new_password)
    # A real unlock, not a shorter wait. Whoever is here proved they hold the
    # phone, which is a stronger claim than the password that locked the account.
    await _clear_failures(db, user, caller_ip)
    user.locked_until = None
    await db.commit()
    audit("auth.password_reset.success", user_id=user.id)
    # No token. A reset is not a sign-in: the new password should be typed once
    # while the driver still remembers choosing it, and `is_phone_verified` stays
    # untouched — proving a phone is CAR-37's business, not this endpoint's.
    return MessageOut(message="Password updated — sign in with your new password")


async def _record_failure(db: AsyncSession, user: User, caller_ip: str) -> None:
    """Bank a failed sign-in against the caller, and against the account as a backstop.

    Called from both doors — wrong password and wrong code. `locked_until` shuts
    both doors to everyone, so it is set at NIST's maximum rather than at a number
    a stranger can reach cheaply. It no longer touches sessions already open; see
    `core.deps.current_user` for why.

    Commits, because the caller raises a 401 immediately after and a discarded
    session would throw the failure away.
    """
    since = _now() - timedelta(seconds=settings.login_failure_window_seconds)
    db.add(LoginFailure(user_id=user.id, caller_ip=caller_ip))
    await _sweep_expired(db, since)
    # The account tally restarts at the last lockout, so reopening the account
    # does not re-lock on the first failure afterwards. It is a timestamp rather
    # than a delete because the rows are also each address's backoff: clearing
    # them would return every address that caused the lock to a full allowance,
    # and a guesser holding a handful of addresses would get a free reset every
    # time they tripped it.
    counted_from = max(since, user.lockout_reset_at) if user.lockout_reset_at else since
    account_failures = await db.scalar(
        select(func.count())
        .select_from(LoginFailure)
        .where(LoginFailure.user_id == user.id, LoginFailure.created_at >= counted_from)
    )
    if (account_failures or 0) >= settings.account_lockout_after:
        user.locked_until = _now() + timedelta(seconds=settings.otp_lockout_seconds)
        user.lockout_reset_at = _now()
        audit("auth.lockout", user_id=user.id, lockout_until=user.locked_until.isoformat())
    await db.commit()
