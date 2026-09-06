from __future__ import annotations

from typing import Any

from pydantic import Field

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
    # Nullable/unique on the model, locked here on purpose: no change-request
    # workflow exists yet (see the approved design's own "flagged, not built"
    # note), so this is read-only — never part of BusinessProfileUpdateIn.
    registration_number: str | None

    @classmethod
    def from_orm_business(cls, business: Any) -> BusinessProfileOut:
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
                "registration_number": business.registration_number,
            }
        )


class BusinessProfileUpdateIn(CamelModel):
    """Partial update — only the fields actually sent are applied, same
    `exclude_unset=True` convention as `BusinessRewardPatchIn`. `name_he` sent
    explicitly as null clears the override (falls back to `name`); omitting it
    leaves the existing value alone.
    """

    name: str | None = Field(default=None, min_length=2, max_length=120)
    name_he: str | None = Field(default=None, max_length=120)
    category: str | None = None
    address: str | None = Field(default=None, min_length=2, max_length=200)


class BusinessProfileResponse(CamelModel):
    profile: BusinessProfileOut
