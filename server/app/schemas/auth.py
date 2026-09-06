from __future__ import annotations

from pydantic import EmailStr, Field

from app.models.enums import Language
from app.schemas._base import CamelModel
from app.schemas.user import UserOut


class RegisterIn(CamelModel):
    name: str = Field(min_length=2, max_length=80)
    email: EmailStr
    # 8 is NIST SP 800-63B's minimum. `LoginIn` deliberately stays at 6: a login
    # checks a credential, it does not enforce the policy that minted it.
    password: str = Field(min_length=8, max_length=200)
    phone: str | None = Field(default=None, pattern=r"^[\d\s+()\-]{6,20}$")
    # A CBS settlement code, not a label (CAR-218).
    city_code: str | None = Field(default=None, max_length=10)
    # Deprecated (CAR-218). Builds shipped before the canonical list send a bare
    # label; the service resolves it against the list rather than 422ing an app
    # already in the field. Remove once those builds are gone.
    city: str | None = Field(default=None, max_length=80, deprecated=True)
    age: int | None = Field(default=None, ge=16, le=120)
    license_year: int | None = Field(default=None, ge=1950, le=2100)


class LoginIn(CamelModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=200)


class AuthOut(CamelModel):
    token: str
    user: UserOut


# ─── Phone + OTP variants (spec 4.2.1) ───────────────────────────────────────

E164_RE = r"^\+[1-9]\d{6,14}$"


class OtpRegisterIn(CamelModel):
    phone: str = Field(pattern=E164_RE)
    name: str = Field(min_length=2, max_length=80)
    language: Language | None = None
    age: int | None = Field(default=None, ge=16, le=120)
    # A CBS settlement code, not a label (CAR-218).
    city_code: str | None = Field(default=None, max_length=10)
    # Deprecated (CAR-218). Builds shipped before the canonical list send a bare
    # label; the service resolves it against the list rather than 422ing an app
    # already in the field. Remove once those builds are gone.
    city: str | None = Field(default=None, max_length=80, deprecated=True)


class OtpRequestIn(CamelModel):
    phone: str = Field(pattern=E164_RE)


class OtpVerifyIn(CamelModel):
    phone: str = Field(pattern=E164_RE)
    code: str = Field(min_length=4, max_length=10)


class OtpSent(CamelModel):
    message: str
    expires_in_seconds: int


# ─── Forgotten password (CAR-60) ─────────────────────────────────────────────
# The request half reuses `OtpRequestIn`: it is the same single field, and a
# `PasswordResetRequestIn` identical to it would only be a second name to keep
# in step with the first.


class PasswordResetIn(CamelModel):
    phone: str = Field(pattern=E164_RE)
    code: str = Field(min_length=4, max_length=10)
    # 8 to match `RegisterIn` — this mints a credential, so it enforces the policy.
    new_password: str = Field(min_length=8, max_length=200)


class MessageOut(CamelModel):
    message: str
