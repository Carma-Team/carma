# No `from __future__ import annotations` here, unlike the other routers.
# SlowAPI's decorator re-exports the handler from its own module, so FastAPI
# would try to resolve string annotations like "RegisterIn" against SlowAPI's
# namespace and fail at import. Real annotation objects need no resolving.

from fastapi import APIRouter, Request, Response, status

from app.core.deps import CurrentUser, DbSession, RequireBrowserHeader, is_browser_request
from app.core.limiter import client_ip, limiter
from app.schemas.auth import (
    AuthOut,
    LoginIn,
    MessageOut,
    OtpRegisterIn,
    OtpRequestIn,
    OtpSent,
    OtpVerifyIn,
    PasswordResetIn,
    RegisterIn,
)
from app.schemas.user import UserOut
from app.services import auth as auth_service
from app.services import users as users_service

router = APIRouter(prefix="/api/auth", tags=["auth"])

# The global default is 30/minute per IP, which is generous for an endpoint that
# either sends a billed SMS or runs bcrypt. These are the routes where a caller
# repeating themselves is already a bad sign, so they get their own ceiling.
# Keyed on the caller's address; the per-phone cap that survives IP rotation
# lives in `services.auth._over_otp_quota`.
SENSITIVE_LIMIT = "5/minute"
# Login and register get a looser ceiling than the OTP routes. An address is a
# poor proxy for a person — mobile carriers put thousands of subscribers behind
# one address via CGNAT, so 5/minute there is a shared budget a household can
# exhaust by accident. Brute force is held off per (account, address) instead
# (`services.auth._reserve_attempt`), which makes a guesser wait without giving a
# stranger a way to make the account's owner wait.
# The OTP routes keep the tight limit: each one spends money on an SMS.
CREDENTIAL_LIMIT = "20/minute"
# Every handler below takes `request` because SlowAPI reads the limit key off it
# and the decorator raises at import time without it. The handlers that check a
# credential also read the caller's address from it — via `client_ip`, never
# `request.client.host`, which behind a proxy is the ingress and would put every
# driver in one backoff bucket.


# ─── Email + password (mobile app's primary flow) ────────────────────────────


@router.post(
    "/register",
    response_model=AuthOut,
    response_model_by_alias=True,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new user with email+password",
)
@limiter.limit(CREDENTIAL_LIMIT)
async def register(request: Request, response: Response, dto: RegisterIn, db: DbSession) -> AuthOut:
    return await auth_service.register_with_password(db, dto, response, is_browser=is_browser_request(request))


@router.post("/login", response_model=AuthOut, response_model_by_alias=True, summary="Login with email+password")
@limiter.limit(CREDENTIAL_LIMIT)
async def login(request: Request, response: Response, dto: LoginIn, db: DbSession) -> AuthOut:
    return await auth_service.login_with_password(
        db, dto, client_ip(request), response, is_browser=is_browser_request(request)
    )


@router.get("/me", response_model=UserOut, response_model_by_alias=True, summary="Get the authenticated user profile")
async def me(user: CurrentUser, db: DbSession) -> UserOut:
    return await users_service.profile_out(db, user)


# ─── Browser session — refresh cookie (CAR-217) ──────────────────────────────
# Both read the session from the httpOnly cookie, not a bearer token — a
# request with no `Authorization` header at all (an expired or reloaded tab)
# is exactly the case these exist for. `RequireBrowserHeader` is the CSRF
# guard: see `core.deps.require_browser_header` for why a cookie-only endpoint
# needs one and `/login` does not. Left off the default rate limit's tighter
# neighbours on purpose — the cookie's ~384 bits make guessing it infeasible,
# so the 30/minute default ceiling (CAR-126) is the right-sized cap, not a
# credential-guessing one.


@router.post(
    "/refresh",
    response_model=AuthOut,
    response_model_by_alias=True,
    summary="Exchange the browser refresh cookie for a new access token",
)
async def refresh(request: Request, response: Response, db: DbSession, _: RequireBrowserHeader) -> AuthOut:
    return await auth_service.refresh_session(db, request, response)


@router.post("/logout", response_model=MessageOut, response_model_by_alias=True, summary="End the browser session")
async def logout(request: Request, response: Response, db: DbSession, _: RequireBrowserHeader) -> MessageOut:
    return await auth_service.logout_session(db, request, response)


# ─── Phone + OTP (spec 4.2.1) ────────────────────────────────────────────────


@router.post(
    "/otp/register",
    response_model=OtpSent,
    response_model_by_alias=True,
    summary="Register a driver profile by phone and send a verification OTP",
)
@limiter.limit(SENSITIVE_LIMIT)
async def otp_register(request: Request, dto: OtpRegisterIn, db: DbSession) -> OtpSent:
    return await auth_service.register_with_otp(db, dto)


@router.post(
    "/otp/request",
    response_model=OtpSent,
    response_model_by_alias=True,
    summary="Send a login OTP to a phone that has previously registered",
)
@limiter.limit(SENSITIVE_LIMIT)
async def otp_request(request: Request, dto: OtpRequestIn, db: DbSession) -> OtpSent:
    return await auth_service.request_login_otp(db, dto.phone)


@router.post("/otp/verify", response_model=AuthOut, response_model_by_alias=True, summary="Exchange an OTP for a JWT")
@limiter.limit(SENSITIVE_LIMIT)
async def otp_verify(request: Request, dto: OtpVerifyIn, db: DbSession) -> AuthOut:
    return await auth_service.verify_otp(db, dto, client_ip(request))


@router.post(
    "/otp/login",
    response_model=AuthOut,
    response_model_by_alias=True,
    summary="Sign in with phone + OTP, establishing a CAR-217 browser session (CAR-265)",
)
@limiter.limit(SENSITIVE_LIMIT)
async def otp_login(request: Request, response: Response, dto: OtpVerifyIn, db: DbSession) -> AuthOut:
    return await auth_service.login_with_otp(
        db, dto, client_ip(request), response, is_browser=is_browser_request(request)
    )


# ─── Forgotten password (CAR-60) ─────────────────────────────────────────────


@router.post(
    "/password/reset/request",
    response_model=OtpSent,
    response_model_by_alias=True,
    summary="Send a password-reset code to a registered phone",
)
@limiter.limit(SENSITIVE_LIMIT)
async def password_reset_request(request: Request, dto: OtpRequestIn, db: DbSession) -> OtpSent:
    return await auth_service.request_password_reset(db, dto.phone)


@router.post(
    "/password/reset/confirm",
    response_model=MessageOut,
    response_model_by_alias=True,
    summary="Set a new password with a reset code, and unlock the account",
)
@limiter.limit(SENSITIVE_LIMIT)
async def password_reset_confirm(request: Request, dto: PasswordResetIn, db: DbSession) -> MessageOut:
    return await auth_service.reset_password(db, dto, client_ip(request))
