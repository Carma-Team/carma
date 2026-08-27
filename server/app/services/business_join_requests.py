"""Public business-registration submissions, stored PENDING for CAR-77 to review.

The only thing that proves a phone here is `User.is_phone_verified` on the
authenticated caller — set exclusively by `services.auth.verify_otp`. No route
in this module reads a phone number out of the request body; the row's `phone`
is copied from `current.phone`, never accepted as input. See CLAUDE.md's
ownership notes and CAR-42 for why this must stay that way.
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import audit
from app.models import Business, BusinessCategory, BusinessJoinRequest, BusinessJoinRequestStatus, User, UserRole
from app.schemas.business_join_request import (
    BusinessJoinRequestAdminListOut,
    BusinessJoinRequestAdminOut,
    BusinessJoinRequestIn,
    BusinessJoinRequestOut,
    BusinessJoinRequestStatusOut,
)
from app.services import business as business_service

_CATEGORY_BY_STR = {c.value.lower(): c for c in BusinessCategory}
_STATUS_BY_STR = {s.value.lower(): s for s in BusinessJoinRequestStatus}

# Structured 409 codes — read by the caller, never a raw constraint name.
ALREADY_OWNS_BUSINESS = "ALREADY_OWNS_BUSINESS"
REGISTRATION_NUMBER_TAKEN = "REGISTRATION_NUMBER_TAKEN"
APPLICANT_ROLE_INVALID = "APPLICANT_ROLE_INVALID"
INVALID_STATE_TRANSITION = "INVALID_STATE_TRANSITION"

# Postgres's own constraint name, not string-matched: asyncpg parses it out of
# the wire protocol's ErrorResponse and exposes it as `.constraint_name` on the
# real driver exception (SQLAlchemy chains it on via `raise ... from error`, so
# it survives as `IntegrityError.orig.__cause__`). Maps each of approve()'s two
# reachable UNIQUE constraints to the code a pre-check would have used for the
# same conflict — this is only the *last-resort* guarantee for whatever a
# pre-check's own lock didn't cover; unrecognized names fall back to the
# registration-number code, the only other UNIQUE constraint this insert can trip.
_UNIQUE_VIOLATION_CODE_BY_CONSTRAINT = {
    "businesses_owner_user_id_key": ALREADY_OWNS_BUSINESS,
    "uq_businesses_registration_number": REGISTRATION_NUMBER_TAKEN,
}

_UNIQUE_VIOLATION_MESSAGE_BY_CODE = {
    ALREADY_OWNS_BUSINESS: "This applicant already owns a business",
    REGISTRATION_NUMBER_TAKEN: "This registration number already belongs to a business",
}


def _approval_conflict_code(e: IntegrityError) -> str:
    driver_error = getattr(e.orig, "__cause__", None)
    constraint = getattr(driver_error, "constraint_name", None)
    if not isinstance(constraint, str):
        return REGISTRATION_NUMBER_TAKEN
    return _UNIQUE_VIOLATION_CODE_BY_CONSTRAINT.get(constraint, REGISTRATION_NUMBER_TAKEN)


def parse_status_filter(value: str | None) -> BusinessJoinRequestStatus | None:
    if value is None:
        return None
    parsed = _STATUS_BY_STR.get(value.lower())
    if parsed is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown status '{value}'")
    return parsed


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

    # CAR-77: a request that can never be approved is worse than no request —
    # refuse it at submission instead of leaving it PENDING forever. This is a
    # courtesy check; approve() re-checks under a row lock and the DB UNIQUE
    # constraint on Business.registration_number is the actual guarantee.
    already_approved = await db.scalar(select(Business.id).where(Business.registration_number == registration_number))
    if already_approved is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "This business is already registered")

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


async def list_requests(
    db: AsyncSession, status_filter: BusinessJoinRequestStatus | None
) -> BusinessJoinRequestAdminListOut:
    """CAR-77 review list. Newest first, optionally narrowed to one status so a
    decision already made can still be pulled back up and re-read."""
    query = select(BusinessJoinRequest).order_by(BusinessJoinRequest.created_at.desc())
    if status_filter is not None:
        query = query.where(BusinessJoinRequest.status == status_filter)
    requests = (await db.scalars(query)).all()
    return BusinessJoinRequestAdminListOut(requests=[BusinessJoinRequestAdminOut.from_orm_request(r) for r in requests])


async def _locked_request(db: AsyncSession, request_id: str) -> BusinessJoinRequest:
    """Lock the row before deciding, so two admins racing the same request
    serialize here rather than both reading PENDING and both acting on it."""
    request = await db.scalar(select(BusinessJoinRequest).where(BusinessJoinRequest.id == request_id).with_for_update())
    if request is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Business join request not found")
    return request


async def approve(db: AsyncSession, admin: User, request_id: str) -> BusinessJoinRequestAdminOut:
    request = await _locked_request(db, request_id)

    if request.status == BusinessJoinRequestStatus.APPROVED:
        # Idempotent: the earlier approval already created the Business: nothing
        # left to do, and definitely not a second one.
        return BusinessJoinRequestAdminOut.from_orm_request(request)
    if request.status == BusinessJoinRequestStatus.REJECTED:
        # A decision, once made, does not flip. Wrong details mean reject and
        # resubmit — see CAR-77's scope — not reopening a closed request.
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {"code": INVALID_STATE_TRANSITION, "message": "This request was already rejected"},
        )

    # Locks the applicant row too: two different PENDING requests naming the
    # same applicant (only possible once the first is no longer PENDING, since
    # CAR-42's partial unique index blocks two live requests per applicant)
    # must still serialize their role/ownership checks against each other.
    applicant = await db.scalar(select(User).where(User.id == request.applicant_user_id).with_for_update())
    assert applicant is not None, "applicant_user_id is a NOT NULL FK to users"

    # Checked before the role check below: an applicant who already owns a
    # Business also already has role=BUSINESS (the only way that role is ever
    # set is this same approve() call), so ALREADY_OWNS_BUSINESS — the more
    # specific, ticket-mandated reason — must win over the generic role guard.
    already_owns = await db.scalar(select(Business.id).where(Business.owner_user_id == applicant.id))
    if already_owns is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {"code": ALREADY_OWNS_BUSINESS, "message": "This applicant already owns a business"},
        )

    if applicant.role != UserRole.DRIVER:
        # Catches an applicant who is ADMIN, or BUSINESS with no Business row
        # (an orphaned state the schema does not otherwise prevent). Never
        # silently overwrite an existing role.
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {"code": APPLICANT_ROLE_INVALID, "message": "The applicant is no longer a driver account"},
        )

    regnum_taken = await db.scalar(
        select(Business.id).where(Business.registration_number == request.registration_number)
    )
    if regnum_taken is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {"code": REGISTRATION_NUMBER_TAKEN, "message": "This registration number already belongs to a business"},
        )

    business = Business(
        owner_user_id=applicant.id,
        name=request.name,
        name_he=request.name_he,
        category=request.category,
        location_lat=request.location_lat,
        location_lng=request.location_lng,
        address=request.address,
        registration_number=request.registration_number,
    )
    db.add(business)
    # Flushed so `business.id` exists before the membership row below is built
    # from it — the FK the OWNER row needs, not yet assigned on an unflushed
    # ORM object.
    await db.flush()
    # CAR-74: authorization for /api/business/* now comes from this row, not
    # from `owner_user_id` — without it the applicant's first request after
    # approval would 403.
    await business_service.ensure_owner_membership(db, business.id, applicant.id)
    applicant.role = UserRole.BUSINESS
    request.status = BusinessJoinRequestStatus.APPROVED
    request.reviewed_at = datetime.now(UTC)

    try:
        await db.commit()
    except IntegrityError as e:
        # Final guarantee, for whatever the pre-checks above couldn't see under
        # their own locks — e.g. Business.owner_user_id or
        # Business.registration_number's UNIQUE constraints. Rolls back the
        # Business insert, the role change and the status flip together.
        await db.rollback()
        code = _approval_conflict_code(e)
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {"code": code, "message": _UNIQUE_VIOLATION_MESSAGE_BY_CODE[code]},
        ) from e

    await db.refresh(request)
    audit(
        "business.join_request.approved",
        admin_id=admin.id,
        request_id=request.id,
        applicant_user_id=applicant.id,
        business_id=business.id,
    )
    return BusinessJoinRequestAdminOut.from_orm_request(request)


async def reject(db: AsyncSession, admin: User, request_id: str, reviewer_note: str) -> BusinessJoinRequestAdminOut:
    request = await _locked_request(db, request_id)

    if request.status == BusinessJoinRequestStatus.REJECTED:
        # Idempotent: the decision already stands. Does not overwrite the
        # earlier reviewer_note with a second, possibly different, one.
        return BusinessJoinRequestAdminOut.from_orm_request(request)
    if request.status == BusinessJoinRequestStatus.APPROVED:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {"code": INVALID_STATE_TRANSITION, "message": "This request was already approved"},
        )

    request.status = BusinessJoinRequestStatus.REJECTED
    request.reviewer_note = reviewer_note
    request.reviewed_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(request)

    audit("business.join_request.rejected", admin_id=admin.id, request_id=request.id)
    return BusinessJoinRequestAdminOut.from_orm_request(request)
