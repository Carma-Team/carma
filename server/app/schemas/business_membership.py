from __future__ import annotations

from datetime import datetime

from pydantic import EmailStr

from app.models.enums import BusinessMembershipRole
from app.schemas._base import CamelModel


class BusinessMemberOut(CamelModel):
    """One row of `business_memberships`, joined with the user it names — the
    only user fields this page needs (CAR-117), not a full `UserOut`."""

    id: str
    user_id: str
    name: str | None = None
    email: EmailStr | None = None
    role: BusinessMembershipRole
    joined_at: datetime


class BusinessMembersOut(CamelModel):
    members: list[BusinessMemberOut]


class BusinessMemberResponse(CamelModel):
    member: BusinessMemberOut


class BusinessMemberRoleIn(CamelModel):
    role: BusinessMembershipRole
