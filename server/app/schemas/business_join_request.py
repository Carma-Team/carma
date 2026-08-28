from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import Field

from app.models.business_join_request import BusinessJoinRequest
from app.schemas._base import CamelModel

JoinRequestStatus = Literal["none", "pending", "approved", "rejected"]


class BusinessJoinRequestIn(CamelModel):
    """Submission payload. No `phone`, no `userId` — both come from the caller's
    own OTP-verified session (`CurrentUser`), never from the request body."""

    name: str = Field(min_length=2, max_length=120)
    name_he: str | None = Field(default=None, max_length=120)
    category: str | None = None
    location_lat: float = Field(ge=-90, le=90)
    location_lng: float = Field(ge=-180, le=180)
    address: str | None = Field(default=None, max_length=200)
    registration_number: str = Field(min_length=1, max_length=64)
    contact_person: str = Field(min_length=2, max_length=120)


class BusinessJoinRequestOut(CamelModel):
    id: str
    status: JoinRequestStatus
    created_at: datetime

    @classmethod
    def from_orm_request(cls, request: BusinessJoinRequest) -> BusinessJoinRequestOut:
        return cls(id=request.id, status=request.status.value.lower(), created_at=request.created_at)


class BusinessJoinRequestStatusOut(CamelModel):
    """The applicant's own status — nothing here implies business access."""

    status: JoinRequestStatus
    created_at: datetime | None = None
    reviewer_note: str | None = None

    @classmethod
    def from_orm_request(cls, request: BusinessJoinRequest | None) -> BusinessJoinRequestStatusOut:
        if request is None:
            return cls(status="none")
        return cls(
            status=request.status.value.lower(),
            created_at=request.created_at,
            reviewer_note=request.reviewer_note,
        )


class BusinessJoinRequestAdminOut(CamelModel):
    """The full submission, for CAR-77's admin review and decision routes."""

    id: str
    status: JoinRequestStatus
    name: str
    name_he: str | None
    category: str
    location_lat: float
    location_lng: float
    address: str | None
    registration_number: str
    contact_person: str
    phone: str
    created_at: datetime
    reviewed_at: datetime | None
    reviewer_note: str | None

    @classmethod
    def from_orm_request(cls, request: BusinessJoinRequest) -> BusinessJoinRequestAdminOut:
        return cls(
            id=request.id,
            status=request.status.value.lower(),
            name=request.name,
            name_he=request.name_he,
            category=request.category.value.lower(),
            location_lat=request.location_lat,
            location_lng=request.location_lng,
            address=request.address,
            registration_number=request.registration_number,
            contact_person=request.contact_person,
            phone=request.phone,
            created_at=request.created_at,
            reviewed_at=request.reviewed_at,
            reviewer_note=request.reviewer_note,
        )


class BusinessJoinRequestAdminListOut(CamelModel):
    requests: list[BusinessJoinRequestAdminOut]


class BusinessJoinRequestRejectIn(CamelModel):
    """The reason field on reject — the only thing an admin submits. Required:
    an applicant reads this back through their own status endpoint, and an
    empty reason tells them nothing."""

    reviewer_note: str = Field(min_length=1, max_length=500)
