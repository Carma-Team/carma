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
import hmac
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
    BusinessInvitationListItem,
    BusinessInvitationOut,
    BusinessInvitationPreviewOut,
)
from app.services.business import lock_user_for_membership_change

_TOKEN_LEN = 10
_INVITABLE_ROLES = {"manager": BusinessMembershipRole.MANAGER, "cashier": BusinessMembershipRole.CASHIER}
_EXPIRES_AFTER = timedelta(hours=72)

ALREADY_MEMBER = "ALREADY_MEMBER"
ALREADY_REDEEMED = "ALREADY_REDEEMED"
# CAR-118 review item 3: this portal cannot place an account into two
# businesses (business switching is out of scope), so accepting into a
# second one would create a membership the account has no way to use here.
INCOMPATIBLE_BUSINESS = "INCOMPATIBLE_BUSINESS"

# A dedicated, derived key rather than `settings.jwt_secret` used directly:
# domain-separated so a JWT-signing compromise and an invitation-hash
# compromise stay independent incidents. Computed once at import time, not
# per call — it never changes while the process is up.
_TOKEN_HASH_KEY = hashlib.sha256(f"business-invitation-token-hash:{settings.jwt_secret}".encode()).digest()


def _hash(token: str) -> str:
    """Keyed HMAC, not a bare hash: this token is a deliberately short,
    readable ~49-bit code (so it can be read aloud at a counter), and a fast,
    unkeyed digest of that few bits of entropy is recoverable offline well
    within the 72h window on a single modern GPU. Keying it on
    `_TOKEN_HASH_KEY` means a database-only leak carries no way to even test a
    guess — computing this hash for a candidate token needs the server's
    secret, which the dump does not contain. `hash_refresh_token` gets away
    with a bare SHA-256 only because its input already has ~384 bits of
    entropy; this one does not, so it cannot reuse that shortcut.
    """
    return hmac.new(_TOKEN_HASH_KEY, token.encode(), hashlib.sha256).hexdigest()


def _new_token() -> str:
    return "".join(secrets.choice(READABLE_ALPHABET) for _ in range(_TOKEN_LEN))


def _link(token: str) -> str:
    """A URL fragment, not a path segment. `#{token}` never leaves the
    browser — it is not sent in the HTTP request line at all, to this server
    or to any CDN/proxy in front of it, so it cannot appear in a web-host
    access log the way a path segment inevitably would. `AcceptInvitationPage`
    reads it via `location.hash`, not `useParams`."""
    return f"{settings.invite_base_url.rstrip('/')}/business-invite#{token}"


def _unknown_invitation() -> HTTPException:
    """A fresh instance every call — never a shared module-level object.

    Every invalid state (unknown, expired, redeemed, revoked) must read
    identically (CAR-76's security notes), which is why every one of those
    branches raises through this one function — but each call still builds
    its own exception. Reusing a single instance would accumulate a traceback,
    and everything the traceback keeps alive (the request's token, the DB
    session), across every invalid-token request the process ever handles.
    """
    return HTTPException(status.HTTP_404_NOT_FOUND, "Unknown or expired invitation")


async def create_invitation(
    db: AsyncSession, business: Business, issuer: User, dto: BusinessInvitationIn
) -> BusinessInvitationOut:
    """OWNER-only at the route (`CurrentBusinessOwner`); the role ceiling this
    enforces — never OWNER — comes from `_INVITABLE_ROLES` not including it, so
    an invitation can never carry a role higher than the OWNER who alone can
    issue one already holds."""
    role = _INVITABLE_ROLES[dto.role]

    # Collisions are vanishingly unlikely (31^10) but cheap to survive, the same
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


async def list_pending_invitations(db: AsyncSession, business: Business) -> list[BusinessInvitationListItem]:
    """The OWNER-facing list (CAR-118) — same "pending" predicate
    `revoke_invitation` and `accept_invitation` race against, so a row shown
    here is exactly a row still capable of being redeemed or revoked."""
    now = datetime.now(UTC)
    rows = (
        await db.scalars(
            select(BusinessInvitation)
            .where(
                BusinessInvitation.business_id == business.id,
                BusinessInvitation.redeemed_at.is_(None),
                BusinessInvitation.revoked_at.is_(None),
                BusinessInvitation.expires_at > now,
            )
            .order_by(BusinessInvitation.created_at.desc())
        )
    ).all()
    return [
        BusinessInvitationListItem(
            id=row.id,
            role="manager" if row.role == BusinessMembershipRole.MANAGER else "cashier",
            created_at=row.created_at,
            expires_at=row.expires_at,
        )
        for row in rows
    ]


async def revoke_invitation(db: AsyncSession, business: Business, invitation_id: str) -> None:
    """Immediate, and safe against a concurrent `accept_invitation`.

    Both act through a conditional UPDATE on the same
    `redeemed_at IS NULL AND revoked_at IS NULL AND expires_at > now` predicate,
    so whichever transaction's UPDATE reaches Postgres first is the only one
    that can still change the row — the loser's own WHERE clause matches
    nothing once the winner commits, the same competition `consume_voucher`
    runs against a racing peek. The same predicate is also what keeps this a
    no-op against an invitation that is already redeemed, already revoked, or
    simply expired: none of those is "pending," so there is nothing left here
    for a revoke to do.
    """
    # Captured before any rollback below: `rollback()` expires every attribute
    # on every object in the session, and re-reading `business.id` afterwards
    # would trigger an implicit lazy-load outside the async context that can
    # service one (`MissingGreenlet`).
    business_id = business.id
    now = datetime.now(UTC)
    revoked: CursorResult[Any] = await db.execute(  # type: ignore[assignment]
        update(BusinessInvitation)
        .where(
            BusinessInvitation.id == invitation_id,
            BusinessInvitation.business_id == business_id,
            BusinessInvitation.redeemed_at.is_(None),
            BusinessInvitation.revoked_at.is_(None),
            BusinessInvitation.expires_at > now,
        )
        .values(revoked_at=now)
    )
    if revoked.rowcount == 1:
        await db.commit()
        audit("business.invitation.revoked", business_id=business_id, invitation_id=invitation_id)
        return

    await db.rollback()
    # The UPDATE's rowcount alone can't tell "no such invitation" (404) apart
    # from "already redeemed" (a real conflict — nothing left to revoke) or
    # "already revoked or expired" (the caller's goal — an unusable invitation
    # — already holds, so a silent no-op rather than a second audit event for
    # a fact that is already true).
    current = await db.scalar(
        select(BusinessInvitation).where(
            BusinessInvitation.id == invitation_id, BusinessInvitation.business_id == business_id
        )
    )
    if current is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invitation not found")
    if current.redeemed_at is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {"code": ALREADY_REDEEMED, "message": "This invitation has already been redeemed"},
        )


async def _valid_invitation(db: AsyncSession, token: str) -> BusinessInvitation:
    invitation = await db.scalar(
        select(BusinessInvitation)
        .where(BusinessInvitation.token_hash == _hash(token))
        .options(selectinload(BusinessInvitation.business))
    )
    if invitation is None:
        raise _unknown_invitation()
    now = datetime.now(UTC)
    if invitation.redeemed_at is not None or invitation.revoked_at is not None or invitation.expires_at <= now:
        raise _unknown_invitation()
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

    # Held for the rest of this transaction — serializes this check-then-write
    # against every other membership-creating path for the same user (see the
    # lock's own docstring), so the two queries below see a picture that
    # cannot change out from under them before the commit at the end.
    await lock_user_for_membership_change(db, current.id)

    memberships = (await db.scalars(select(BusinessMembership).where(BusinessMembership.user_id == current.id))).all()
    existing = next((m for m in memberships if m.business_id == invitation.business_id), None)
    if existing is not None:
        # Neither the invitation nor the membership table is touched — the
        # ticket is explicit that this must change nothing.
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {"code": ALREADY_MEMBER, "message": "You are already a member of this business"},
        )
    if memberships:
        # A membership in some *other* business — accepting would create a
        # second, real membership this portal has no way to enter (business
        # switching is out of scope). Same "change nothing" contract as
        # ALREADY_MEMBER above: the invitation stays exactly as valid as it
        # was before this call.
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {
                "code": INCOMPATIBLE_BUSINESS,
                "message": "This account already belongs to a different business",
            },
        )

    # Conditional UPDATE, not a read-then-write: two recipients racing the same
    # token, or the same recipient double-tapping accept, must not both see
    # "redeemed, rowcount 1" — the same shape as consume_voucher's status flip.
    # This predicate is also `revoke_invitation`'s — see there for how the two
    # compete safely against each other, not just against themselves.
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
        raise _unknown_invitation()

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
