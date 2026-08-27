"""One-time business-permission invitations (CAR-76).

`services/invites.py` is the wrong model to copy from: that code is a
permanent, reusable friend-referral link, and forwarding it is the accepted
trade. An invitation here grants access to a business, so it takes the
opposite shape — single-use, time-boxed, and revocable — which is why this is
a separate module rather than an extension of that one. What is shared is the
human-readable alphabet (`core.security.READABLE_ALPHABET`) and the
conditional-UPDATE pattern `business_service.consume_voucher` uses to make a
one-time state transition race-safe.
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import CursorResult, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.core.audit import audit
from app.core.security import READABLE_ALPHABET
from app.models import Business, BusinessInvitation, BusinessMembership, BusinessMembershipRole, User
from app.schemas.business_invitation import (
    BusinessInvitationAcceptOut,
    BusinessInvitationIn,
    BusinessInvitationOut,
    BusinessInvitationPreviewOut,
)

_TOKEN_LEN = 10
_INVITABLE_ROLES = {"manager": BusinessMembershipRole.MANAGER, "cashier": BusinessMembershipRole.CASHIER}
_EXPIRES_AFTER = timedelta(hours=72)

# The generic 404 every invalid token gets — unknown, expired, redeemed and
# revoked must all read identically (CAR-76's security notes), so this is the
# one HTTPException raised from every branch that fails the lookup, never a
# variant with more detail.
_UNKNOWN_INVITATION = HTTPException(status.HTTP_404_NOT_FOUND, "Unknown or expired invitation")

ALREADY_MEMBER = "ALREADY_MEMBER"


def _hash(token: str) -> str:
    """SHA-256, not bcrypt: this token is ~49 bits of CSPRNG output used only as
    its own lookup key, the same reasoning `core.security.hash_refresh_token`
    documents — a salted hash would make an equality lookup impossible."""
    return hashlib.sha256(token.encode()).hexdigest()


def _new_token() -> str:
    return "".join(secrets.choice(READABLE_ALPHABET) for _ in range(_TOKEN_LEN))


def _link(token: str) -> str:
    return f"{settings.invite_base_url.rstrip('/')}/business-invite/{token}"


async def create_invitation(
    db: AsyncSession, business: Business, issuer: User, dto: BusinessInvitationIn
) -> BusinessInvitationOut:
    """OWNER-only at the route (`CurrentBusinessOwner`); the role ceiling this
    enforces — never OWNER — comes from `_INVITABLE_ROLES` not including it, so
    an invitation can never carry a role higher than the OWNER who alone can
    issue one already holds."""
    role = _INVITABLE_ROLES[dto.role]

    # Collisions are vanishingly unlikely (32^10) but cheap to survive, the same
    # retry `services.invites.get_or_create_link` uses for its own code space.
    for _ in range(5):
        token = _new_token()
        invitation = BusinessInvitation(
            business_id=business.id,
            role=role,
            token_hash=_hash(token),
            created_by_user_id=issuer.id,
            expires_at=datetime.now(UTC) + _EXPIRES_AFTER,
        )
        db.add(invitation)
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            continue
        await db.refresh(invitation)
        audit(
            "business.invitation.created",
            business_id=business.id,
            invitation_id=invitation.id,
            issuer_id=issuer.id,
            role=role.value,
        )
        return BusinessInvitationOut(
            id=invitation.id,
            role=dto.role,
            token=token,
            url=_link(token),
            expires_at=invitation.expires_at,
        )

    raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Could not allocate an invitation token")


async def revoke_invitation(db: AsyncSession, business: Business, invitation_id: str) -> None:
    """Immediate: a revoked invitation fails the very next accept, since its
    conditional UPDATE checks `revoked_at IS NULL` alongside everything else.

    Scoped to `business` and answering 404 for another business's invitation,
    like `_owned_reward` — a 403 would confirm the id exists elsewhere.
    """
    invitation = await db.scalar(
        select(BusinessInvitation).where(
            BusinessInvitation.id == invitation_id, BusinessInvitation.business_id == business.id
        )
    )
    if invitation is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invitation not found")

    if invitation.revoked_at is None:
        invitation.revoked_at = datetime.now(UTC)
        await db.commit()
        audit("business.invitation.revoked", business_id=business.id, invitation_id=invitation.id)


async def _valid_invitation(db: AsyncSession, token: str) -> BusinessInvitation:
    invitation = await db.scalar(
        select(BusinessInvitation)
        .where(BusinessInvitation.token_hash == _hash(token))
        .options(selectinload(BusinessInvitation.business))
    )
    if invitation is None:
        raise _UNKNOWN_INVITATION
    now = datetime.now(UTC)
    if invitation.redeemed_at is not None or invitation.revoked_at is not None or invitation.expires_at <= now:
        raise _UNKNOWN_INVITATION
    return invitation


async def preview_invitation(db: AsyncSession, token: str) -> BusinessInvitationPreviewOut:
    """What an authenticated recipient sees before deciding to accept.

    Requires only `CurrentUser` — the recipient has no membership yet, so this
    must not sit behind `current_business`.
    """
    invitation = await _valid_invitation(db, token)
    role_str = "manager" if invitation.role == BusinessMembershipRole.MANAGER else "cashier"
    return BusinessInvitationPreviewOut(
        business_id=invitation.business_id,
        business_name=invitation.business.name,
        role=role_str,
        expires_at=invitation.expires_at,
    )


async def accept_invitation(db: AsyncSession, current: User, token: str) -> BusinessInvitationAcceptOut:
    invitation = await _valid_invitation(db, token)

    existing = await db.scalar(
        select(BusinessMembership).where(
            BusinessMembership.user_id == current.id, BusinessMembership.business_id == invitation.business_id
        )
    )
    if existing is not None:
        # Neither the invitation nor the membership table is touched — the
        # ticket is explicit that this must change nothing.
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {"code": ALREADY_MEMBER, "message": "You are already a member of this business"},
        )

    # Conditional UPDATE, not a read-then-write: two recipients racing the same
    # token, or the same recipient double-tapping accept, must not both see
    # "redeemed, rowcount 1" — the same shape as consume_voucher's status flip.
    now = datetime.now(UTC)
    invitation_id = invitation.id
    role = invitation.role
    business_id = invitation.business_id
    redeemed: CursorResult[Any] = await db.execute(  # type: ignore[assignment]
        update(BusinessInvitation)
        .where(
            BusinessInvitation.id == invitation_id,
            BusinessInvitation.redeemed_at.is_(None),
            BusinessInvitation.revoked_at.is_(None),
            BusinessInvitation.expires_at > now,
        )
        .values(redeemed_at=now, redeemed_by_user_id=current.id)
    )
    if redeemed.rowcount == 0:
        # Lost the race — someone else redeemed or revoked it a moment ago.
        # Indistinguishable from unknown, same as every other invalid state.
        await db.rollback()
        raise _UNKNOWN_INVITATION

    db.add(BusinessMembership(user_id=current.id, business_id=business_id, role=role))
    try:
        await db.commit()
    except IntegrityError as e:
        # The only reachable UNIQUE constraint here is (user_id, business_id) —
        # the recipient became a member through some other path (a second
        # invitation to the same business, a join-request approval) between
        # the pre-check above and this commit. Rolling back undoes the
        # invitation's redeemed_at too, so it is not silently burned on a
        # membership that was never created.
        await db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {"code": ALREADY_MEMBER, "message": "You are already a member of this business"},
        ) from e

    audit(
        "business.invitation.accepted",
        business_id=business_id,
        invitation_id=invitation_id,
        user_id=current.id,
        role=role.value,
    )
    role_str = "manager" if role == BusinessMembershipRole.MANAGER else "cashier"
    return BusinessInvitationAcceptOut(business_id=business_id, role=role_str)
