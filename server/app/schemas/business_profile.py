from __future__ import annotations

from typing import Any

from pydantic import EmailStr, Field, field_validator, model_validator

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
    def from_orm_business(cls, business: Any, owner: Any | None) -> BusinessProfileOut:
        # Same lowercasing as RewardOut.from_orm_reward — the enum's own value
        # is upper-case ("FOOD"), but lib/businessCategory.ts's client-side
        # union is lower-case.
        return cls.model_validate(
            {
                "id": business.id,
                "name": business.name,
                "name_he": business.name_he,
                "category": business.category.value.lower(),
                "address": business.address,
                "location_lat": business.location_lat,
                "location_lng": business.location_lng,
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
    Every other field here backs a column the product never allows to go
    empty, so an explicit null on any of them is rejected at the API boundary
    rather than reaching `setattr` and failing at commit against a NOT NULL
    constraint (or, for `address`, silently leaving the business without one).

    `address`, `location_lat` and `location_lng` must be sent together or not
    at all. `BusinessRegistrationPage`'s own confirm-location step is what
    actually produces that pair today (geocode the typed address, let the
    applicant confirm or drag the pin) — a PATCH that changed the text alone
    would leave the map pin pointing at the old place while the address on
    screen said something else.
    """

    name: str | None = Field(default=None, min_length=2, max_length=120)
    name_he: str | None = Field(default=None, max_length=120)
    category: str | None = None
    address: str | None = Field(default=None, min_length=2, max_length=200)
    location_lat: float | None = Field(default=None, ge=-90, le=90)
    location_lng: float | None = Field(default=None, ge=-180, le=180)

    @field_validator("name", "category", "address", "location_lat", "location_lng")
    @classmethod
    def _reject_explicit_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("cannot be null — omit the field to leave it unchanged")
        return value

    @model_validator(mode="after")
    def _address_and_coordinates_move_together(self) -> BusinessProfileUpdateIn:
        location_fields = {"address", "location_lat", "location_lng"}
        sent = location_fields & self.model_fields_set
        if sent and sent != location_fields:
            raise ValueError("address, locationLat and locationLng must be sent together")
        return self


class BusinessProfileResponse(CamelModel):
    profile: BusinessProfileOut
