from __future__ import annotations

import secrets
from datetime import UTC, datetime, timedelta
from typing import Any, TypedDict

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.config import settings
from app.models.enums import UserRole

_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")
JWT_ALGO = "HS256"


class TokenPayload(TypedDict, total=False):
    sub: str
    email: str | None
    phone: str | None
    role: str
    exp: int
    iat: int


def hash_password(password: str) -> str:
    return _pwd.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    return _pwd.verify(password, hashed)


def hash_code(code: str) -> str:
    return _pwd.hash(code)


def verify_code(code: str, hashed: str) -> bool:
    return _pwd.verify(code, hashed)


def random_digits(length: int) -> str:
    return "".join(str(secrets.randbelow(10)) for _ in range(length))


def random_voucher_code() -> str:
    return secrets.token_urlsafe(12).upper().replace("-", "").replace("_", "")[:16]


def create_access_token(*, user_id: str, email: str | None, phone: str | None, role: UserRole) -> str:
    now = datetime.now(UTC)
    payload: dict[str, Any] = {
        "sub": user_id,
        "email": email,
        "phone": phone,
        "role": role.value,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.jwt_expires_minutes)).timestamp()),
    }
    token: str = jwt.encode(payload, settings.jwt_secret, algorithm=JWT_ALGO)
    return token


def decode_access_token(token: str) -> TokenPayload:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[JWT_ALGO])  # type: ignore[no-any-return]
    except JWTError as e:
        raise ValueError(f"invalid token: {e}") from e
