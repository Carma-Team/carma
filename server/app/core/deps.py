from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import user_id_ctx
from app.core.security import decode_access_token
from app.database import get_db
from app.models import Business, User, UserRole

_bearer = HTTPBearer(auto_error=False)

DbSession = Annotated[AsyncSession, Depends(get_db)]


async def current_user(
    db: DbSession,
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> User:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")

    try:
        payload = decode_access_token(creds.credentials)
    except ValueError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(e)) from e

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token missing subject")

    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found")
    # `locked_until` is deliberately not read here. It counts failed sign-ins,
    # which say nothing about a session that was already opened — so honouring it
    # only ever ejected the real driver, mid-trip, on a stranger's guessing.
    # NIST SP 800-63B scopes the limit to the authenticator, and Auth0 likewise
    # blocks logins while treating session revocation as a separate act.
    user_id_ctx.set(user.id)
    return user


CurrentUser = Annotated[User, Depends(current_user)]


async def current_business(request: Request, user: CurrentUser, db: DbSession) -> Business:
    """The Business owned by the authenticated user — the scope of every /api/business route.

    Handlers never take a business id from the client: they operate on whatever
    this returns, which is what keeps one business out of another's rewards.
    """
    if user.role != UserRole.BUSINESS:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Business account required")

    business = await db.scalar(select(Business).where(Business.owner_user_id == user.id))
    if business is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No business is linked to this account")
    # Read back by `limiter.business_key`, which rate-limits the voucher routes
    # per business rather than per address. Delete this and the limit silently
    # falls back to counting addresses — every till in a mall shares one budget.
    request.state.business_id = business.id
    return business


CurrentBusiness = Annotated[Business, Depends(current_business)]


async def current_admin(user: CurrentUser) -> User:
    """An ADMIN, resolved from the DB row `CurrentUser` already re-reads on every
    request — never from the JWT's `role` claim. That is what makes a role
    change (grant or revoke) effective on the very next request instead of
    waiting out a week-long token TTL (CAR-77)."""
    if user.role != UserRole.ADMIN:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin account required")
    return user


CurrentAdmin = Annotated[User, Depends(current_admin)]


def is_browser_request(request: Request) -> bool:
    """Whether this call carries the header only CARMA's own web app sends.

    `lib/auth/authApi.ts` sets `X-Requested-With: XMLHttpRequest` on every
    call it makes; mobile's `client.ts` never has and CAR-217 does not touch
    it. Two different callers read this boolean two different ways — see
    `require_browser_header` (hard gate) and
    `services/auth.py::login_with_password` (soft signal, picks a token TTL).
    """
    return request.headers.get("x-requested-with") == "XMLHttpRequest"


async def require_browser_header(request: Request) -> None:
    """Refuse a cookie-authenticated call that a cross-site page could have sent.

    `/api/auth/refresh` and `/api/auth/logout` read the session from a cookie,
    which a browser attaches to a request regardless of who triggered it — the
    classic CSRF shape. `SameSite=Lax` already stops that today, but it stops
    doing so the moment `REFRESH_COOKIE_SAMESITE` is set to `none` for a
    cross-site deploy. This header is what still stops it then: a custom
    header forces a CORS preflight, and only an allow-listed origin can pass
    one — an attacker's page cannot make the browser send this request with it.
    Standard "verify a custom header" CSRF defence (OWASP), not a token,
    because there is no per-session secret to hand the page in the first place.
    """
    if not is_browser_request(request):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Missing required header")


RequireBrowserHeader = Annotated[None, Depends(require_browser_header)]
