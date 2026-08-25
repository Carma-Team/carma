"""Public business-registration submissions, stored PENDING for CAR-77 to review.

The only thing that proves a phone here is `User.is_phone_verified` on the
authenticated caller — set exclusively by `services.auth.verify_otp`. No route
in this module reads a phone number out of the request body; the row's `phone`
is copied from `current.phone`, never accepted as input. See CLAUDE.md's
ownership notes and CAR-42 for why this must stay that way.
"""

from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import audit
from app.models import BusinessCategory, BusinessJoinRequest, BusinessJoinRequestStatus, User
from app.schemas.business_join_request import (
    BusinessJoinRequestIn,
    BusinessJoinRequestOut,
    BusinessJoinRequestStatusOut,
)

_CATEGORY_BY_STR = {c.value.lower(): c for c in BusinessCategory}


def _parse_category(value: str | None) -> BusinessCategory:
    if value is None:
        return BusinessCategory.OTHER
    category = _CATEGORY_BY_STR.get(value.lower())
    if category is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown category '{value}'")
    return category


async def submit(db: AsyncSession, current: User, dto: BusinessJoinRequestIn) -> BusinessJoinRequestOut:
    if not current.is_phone_verified:
        # Belt-and-braces: every caller reaching here already holds a JWT minted
        # by verify_otp, which is the only place this flag is set. A token from
        # email+password login reaches CurrentUser too, so this is not dead code.
        raise HTTPException(status.HTTP_403_FORBIDDEN, "A verified phone is required to submit a business request")

    registration_number = dto.registration_number.strip()
    category = _parse_category(dto.category)

    # Friendly, specific pre-checks. The partial unique indexes created in
    # 0022_business_join_requests are the actual race-safe guarantee — see the
    # IntegrityError handling below — these two queries only exist to name which
    # rule a *non-racing* caller tripped.
    own_pending = await db.scalar(
        select(BusinessJoinRequest).where(
            BusinessJoinRequest.applicant_user_id == current.id,
            BusinessJoinRequest.status == BusinessJoinRequestStatus.PENDING,
        )
    )
    if own_pending is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "You already have a pending business request")

    business_pending = await db.scalar(
        select(BusinessJoinRequest).where(
            BusinessJoinRequest.registration_number == registration_number,
            BusinessJoinRequest.status == BusinessJoinRequestStatus.PENDING,
        )
    )
    if business_pending is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "This business already has a pending request")

    request = BusinessJoinRequest(
        applicant_user_id=current.id,
        phone=current.phone,
        name=dto.name,
        name_he=dto.name_he,
        category=category,
        location_lat=dto.location_lat,
        location_lng=dto.location_lng,
        address=dto.address,
        registration_number=registration_number,
        contact_person=dto.contact_person,
    )
    db.add(request)
    try:
        await db.commit()
    except IntegrityError as e:
        # A concurrent identical submission won one of the partial unique
        # indexes between the pre-checks above and this commit.
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "A pending request already exists") from e

    await db.refresh(request)
    audit("business.join_request.submitted", user_id=current.id, request_id=request.id)
    return BusinessJoinRequestOut.from_orm_request(request)


async def my_status(db: AsyncSession, current: User) -> BusinessJoinRequestStatusOut:
    """The caller's own most recent request — never another applicant's.

    No id ever comes from the client, so there is nothing here to probe.
    """
    request = await db.scalar(
        select(BusinessJoinRequest)
        .where(BusinessJoinRequest.applicant_user_id == current.id)
        .order_by(BusinessJoinRequest.created_at.desc())
        .limit(1)
    )
    return BusinessJoinRequestStatusOut.from_orm_request(request)
