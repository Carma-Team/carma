# No `from __future__ import annotations` here, unlike the other routers.
# SlowAPI's decorator re-exports the handler from its own module, so FastAPI
# would try to resolve string annotations like "RegisterIn" against SlowAPI's
# namespace and fail at import. Real annotation objects need no resolving.

from fastapi import APIRouter, Request, status

from app.core.deps import CurrentUser, DbSession
from app.core.limiter import limiter
from app.schemas.auth import (
    AuthOut,
    LoginIn,
    OtpRegisterIn,
    OtpRequestIn,
    OtpSent,
    OtpVerifyIn,
    RegisterIn,
)
from app.schemas.user import UserOut
from app.services import auth as auth_service

router = APIRouter(prefix="/api/auth", tags=["auth"])

# The global default is 30/minute per IP, which is generous for an endpoint that
# either sends a billed SMS or runs bcrypt. These are the routes where a caller
# repeating themselves is already a bad sign, so they get their own ceiling.
# Keyed on the caller's address; the per-phone cap that survives IP rotation
# lives in `services.auth._assert_otp_quota`.
SENSITIVE_LIMIT = "5/minute"
# `request` is unused in the handlers below, but SlowAPI reads the limit key off
# it — the decorator raises at import time if the parameter is missing.


# ─── Email + password (mobile app's primary flow) ────────────────────────────


@router.post(
    "/register",
    response_model=AuthOut,
    response_model_by_alias=True,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new user with email+password",
)
@limiter.limit(SENSITIVE_LIMIT)
async def register(request: Request, dto: RegisterIn, db: DbSession) -> AuthOut:
    return await auth_service.register_with_password(db, dto)


@router.post("/login", response_model=AuthOut, response_model_by_alias=True, summary="Login with email+password")
@limiter.limit(SENSITIVE_LIMIT)
async def login(request: Request, dto: LoginIn, db: DbSession) -> AuthOut:
    return await auth_service.login_with_password(db, dto)


@router.get("/me", response_model=UserOut, response_model_by_alias=True, summary="Get the authenticated user profile")
async def me(user: CurrentUser) -> UserOut:
    return UserOut.model_validate(user)


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
    return await auth_service.verify_otp(db, dto)
