from __future__ import annotations

from typing import Any

from pydantic import EmailStr, Field, field_validator

from app.schemas._base import CamelModel


class BusinessProfileOut(CamelModel):
    """The business's own editable record (CAR-341) — distinct from `UserOut`'s
    denormalized `business_*` fields, which exist for the driver-facing app and
    carry only what a nav shell needs, not the full record.
    """

    id: str
    name: str
    name_he: str | None
    category: str
    # Mirrors the business's earliest-created active branch (CAR-341
    # continuation) — never `Business.address/location_lat/location_lng`
    # directly, which are frozen at creation and go stale the moment a branch
    # is edited. Kept here, read-only, for whatever still reads a single
    # address off a business profile; editing one now only happens through
    # `/api/business/branches`.
    address: str | None
    location_lat: float
    location_lng: float
    # Nullable/unique on the model, locked here on purpose: no change-request
    # workflow exists yet (see the approved design's own "flagged, not built"
    # note), so this is read-only — never part of BusinessProfileUpdateIn.
    registration_number: str | None
    # The business's CAR-74 OWNER member (services.business.owner_contact) —
    # never `Business.owner_user_id`, which predates memberships, can be null,
    # and is no longer the app's source of truth for who owns what (see
    # services.users.profile_out). `None` only when a business somehow has no
    # OWNER row at all; the UI shows that honestly rather than guessing.
    owner_name: str | None
    owner_email: EmailStr | None

    @classmethod
    def from_orm_business(cls, business: Any, owner: Any | None, default_branch: Any) -> BusinessProfileOut:
        # Same lowercasing as RewardOut.from_orm_reward — the enum's own value
        # is upper-case ("FOOD"), but lib/businessCategory.ts's client-side
        # union is lower-case.
        return cls.model_validate(
            {
                "id": business.id,
                "name": business.name,
                "name_he": business.name_he,
                "category": business.category.value.lower(),
                "address": default_branch.address,
                "location_lat": default_branch.location_lat,
                "location_lng": default_branch.location_lng,
                "registration_number": business.registration_number,
                "owner_name": owner.name if owner else None,
                "owner_email": owner.email if owner else None,
            }
        )


class BusinessProfileUpdateIn(CamelModel):
    """Partial update — only the fields actually sent are applied, same
    `exclude_unset=True` convention as `BusinessRewardPatchIn`.

    `name_he` is the one field a caller may clear: sent explicitly as null it
    falls back to `name`, and omitting it leaves the existing value alone.
    `name` and `category` back a column the product never allows to go
    empty, so an explicit null on either is rejected at the API boundary
    rather than reaching `setattr` and failing at commit against a NOT NULL
    constraint.

    Deliberately has no `address`/`location_lat`/`location_lng` — a business's
    location is branch data now (CAR-341 continuation), edited only through
    `/api/business/branches`. Keeping a second address-editing path here
    would let this PATCH and a branch edit disagree about which one is real.
    """

    name: str | None = Field(default=None, min_length=2, max_length=120)
    name_he: str | None = Field(default=None, max_length=120)
    category: str | None = None

    @field_validator("name", "category")
    @classmethod
    def _reject_explicit_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("cannot be null — omit the field to leave it unchanged")
        return value


class BusinessProfileResponse(CamelModel):
    profile: BusinessProfileOut
