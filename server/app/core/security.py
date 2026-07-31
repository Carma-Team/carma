from __future__ import annotations

import re
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


# No 0/O/1/I/L — the five characters people get wrong reading a code aloud or
# copying it off a screen. Shared with the invite codes in `services/invites.py`,
# which had this alphabet first; two of them would eventually drift apart.
READABLE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

# 31 symbols at length 10 is ~49 bits. Guessing a live voucher is hopeless at
# that size — a few hundred exist at once out of 31^10 — and it stays short
# enough to say in one breath, which is the whole point. The predecessor was 16
# characters of `token_urlsafe(12).upper()`, unreadable and, because uppercasing
# folds a-z onto A-Z, not uniform either.
VOUCHER_CODE_LENGTH = 10


def random_voucher_code() -> str:
    return "".join(secrets.choice(READABLE_ALPHABET) for _ in range(VOUCHER_CODE_LENGTH))


def normalise_voucher_code(code: str) -> str:
    """A typed-in code, as the database stores it.

    A cashier reading one off a customer's phone types it in lower case, or with
    the grouping the app shows. Folding it here rather than in SQL keeps the
    lookup a plain equality match; `upper()` in the query would skip the index on
    `redemptions.qr_code`.

    Three steps, and the order is the point:

    1. Drop separators. Not only the ASCII hyphen — phone keyboards turn it into
       an en dash, and a Hebrew one offers a maqaf.
    2. Refuse anything left that is not ASCII. Every code we have ever issued is
       A-Z0-9, so this rejects nothing real.
    3. Only now upper-case it.

    Step 2 has to come before step 3, because upper-casing is not
    length-preserving outside ASCII: `ß` becomes `SS`, so a code containing SS
    would answer to it. Rejecting first also spares us the Turkish dotless `ı`,
    which upper-cases to a plain `I`.

    Returns the empty string for input that survives none of this. No code is
    empty, so it simply finds nothing — the caller's 404 is the right answer for
    a code that could never have been issued.
    """
    stripped = _SEPARATORS.sub("", code)
    if not stripped.isascii():
        return ""
    return stripped.upper()


# `\s` already covers the non-breaking space a mobile keyboard can slip in. The
# rest are dashes something other than a plain keyboard produces: U+2010-2015
# (iOS smart punctuation turns a typed hyphen into U+2013), the minus sign, and
# the Hebrew maqaf. Written as escapes, not as the characters — six kinds of
# dash are indistinguishable by eye in a source file.
_SEPARATORS = re.compile(r"[\s_\-\u2010-\u2015\u2212\u05be]+")


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
