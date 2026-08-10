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
