from __future__ import annotations

from fastapi import APIRouter, status

from app.core.deps import CurrentUser, DbSession
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
from app.services import users as users_service

router = APIRouter(prefix="/api/auth", tags=["auth"])


# ─── Email + password (mobile app's primary flow) ────────────────────────────


@router.post(
    "/register",
    response_model=AuthOut,
    response_model_by_alias=True,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new user with email+password",
)
async def register(dto: RegisterIn, db: DbSession) -> AuthOut:
    return await auth_service.register_with_password(db, dto)


@router.post("/login", response_model=AuthOut, response_model_by_alias=True, summary="Login with email+password")
async def login(dto: LoginIn, db: DbSession) -> AuthOut:
    return await auth_service.login_with_password(db, dto)


@router.get("/me", response_model=UserOut, response_model_by_alias=True, summary="Get the authenticated user profile")
async def me(user: CurrentUser, db: DbSession) -> UserOut:
    return await users_service.profile_out(db, user)


# ─── Phone + OTP (spec 4.2.1) ────────────────────────────────────────────────


@router.post(
    "/otp/register",
    response_model=OtpSent,
    response_model_by_alias=True,
    summary="Register a driver profile by phone and send a verification OTP",
)
async def otp_register(dto: OtpRegisterIn, db: DbSession) -> OtpSent:
    return await auth_service.register_with_otp(db, dto)


@router.post(
    "/otp/request",
    response_model=OtpSent,
    response_model_by_alias=True,
    summary="Send a login OTP to a phone that has previously registered",
)
async def otp_request(dto: OtpRequestIn, db: DbSession) -> OtpSent:
    return await auth_service.request_login_otp(db, dto.phone)


@router.post("/otp/verify", response_model=AuthOut, response_model_by_alias=True, summary="Exchange an OTP for a JWT")
async def otp_verify(dto: OtpVerifyIn, db: DbSession) -> AuthOut:
    return await auth_service.verify_otp(db, dto)
