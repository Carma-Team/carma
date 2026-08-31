from __future__ import annotations

from datetime import datetime

from pydantic import EmailStr, Field, field_validator

from app.models.enums import BusinessMembershipRole, Language, UserRole
from app.schemas._base import CamelModel
from app.schemas.friend import FriendshipStatus


class UserOut(CamelModel):
    id: str
    name: str | None = None
    email: EmailStr | None = None
    phone: str | None = None
    role: UserRole
    language: Language
    avatar_url: str | None = None
    age: int | None = None
    city: str | None = None
    license_year: int | None = None
    points: int
    total_points: int
    # Derived, never stored (CAR-73): reserved is the sum of points_cost over
    # this driver's live vouchers, available is points minus that sum. Not on
    # the User model, so users_service.profile_out fills these in after
    # validation — the defaults here only satisfy from_attributes on that read.
    # See rewards_service.reserved_points for why there is no reserved_points column.
    available_points: int = 0
    reserved_points: int = 0
    total_distance: float
    level: int
    is_private: bool = False
    drive_mode_enabled: bool
    bluetooth_device_id: str | None = None
    bluetooth_device_name: str | None = None
    # This whole block is resolved from `business_memberships` on every read
    # (never `Business.owner_user_id`, `User.role`, or the JWT) — see
    # users_service.profile_out. Independent of the account's global role: a
    # DRIVER can hold a CASHIER membership (CAR-74). businessCategory is what
    # the business screens key new rewards off.
    business_id: str | None = None
    business_category: str | None = None
    # Raw fields, not a server-resolved fallback — the business web shell
    # picks between them itself based on the active UI language (HE prefers
    # businessNameHe, EN prefers businessName), which the server has no
    # notion of.
    business_name: str | None = None
    business_name_he: str | None = None
    business_membership_role: BusinessMembershipRole | None = None
    # True for more than one membership. CAR-258 fails closed rather than
    # picking one arbitrarily — every field above stays null, exactly like no
    # membership at all, so this is what tells the two states apart.
    business_membership_ambiguous: bool = False
    created_at: datetime


class FoundUserOut(CamelModel):
    """Deliberately narrow: phone search is a lookup, not a profile read."""

    id: str
    name: str | None = None
    city: str | None = None


class UserSearchOut(CamelModel):
    user: FoundUserOut


class MatchContactsIn(CamelModel):
    """SHA-256 hex digests of canonical (E.164) phone numbers — never raw numbers.

    The cap bounds both the work per call and how much of an address book can be
    probed at once; the client pages through a large book.
    """

    phone_hashes: list[str] = Field(max_length=1000)


class ContactMatchOut(CamelModel):
    phone_hash: str
    id: str
    name: str | None = None
    city: str | None = None
    friend_status: FriendshipStatus = "none"


class MatchContactsOut(CamelModel):
    matches: list[ContactMatchOut]


class UpdateProfileIn(CamelModel):
    name: str | None = Field(default=None, min_length=2, max_length=80)
    language: Language | None = None
    age: int | None = Field(default=None, ge=16, le=120)
    city: str | None = Field(default=None, max_length=80)
    is_private: bool | None = None
    drive_mode_enabled: bool | None = None

    @field_validator("language", "is_private", "drive_mode_enabled")
    @classmethod
    def _reject_explicit_null(cls, value: Language | bool | None) -> Language | bool:
        """These three back NOT NULL columns; name, age and city are clearable.

        An unset field never reaches here, so omitting the key still leaves the
        setting alone. Only an explicit null does, and it used to answer 500.
        """
        if value is None:
            raise ValueError("cannot be null — omit the field to leave it unchanged")
        return value


class UpdateLocationIn(CamelModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
