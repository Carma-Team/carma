from __future__ import annotations

from typing import Any

from pydantic import Field, field_validator, model_validator

from app.schemas._base import CamelModel


class BranchOut(CamelModel):
    id: str
    name: str | None
    address: str | None
    location_lat: float
    location_lng: float
    is_active: bool

    @classmethod
    def from_orm_branch(cls, branch: Any) -> BranchOut:
        return cls.model_validate(
            {
                "id": branch.id,
                "name": branch.name,
                "address": branch.address,
                "location_lat": branch.location_lat,
                "location_lng": branch.location_lng,
                "is_active": branch.is_active,
            }
        )


class BranchCreateIn(CamelModel):
    """A new branch always supplies address and coordinates together — there
    is no partial state to reject the way `BranchUpdateIn` has to for a PATCH.
    """

    name: str | None = Field(default=None, max_length=120)
    address: str = Field(min_length=2, max_length=200)
    location_lat: float = Field(ge=-90, le=90)
    location_lng: float = Field(ge=-180, le=180)


class BranchUpdateIn(CamelModel):
    """Partial update, same `exclude_unset=True` convention as
    `BusinessProfileUpdateIn`.

    `name` is the one field a caller may clear — sent explicitly as null it
    falls back to showing the address alone (see the approved design's own
    "no name shows the address" note). `address`, `location_lat` and
    `location_lng` must be sent together or not at all, and `is_active`
    cannot be nulled, for the same reasons `BusinessProfileUpdateIn` rejects
    an explicit null on its own non-clearable fields.
    """

    name: str | None = Field(default=None, max_length=120)
    address: str | None = Field(default=None, min_length=2, max_length=200)
    location_lat: float | None = Field(default=None, ge=-90, le=90)
    location_lng: float | None = Field(default=None, ge=-180, le=180)
    is_active: bool | None = None

    @field_validator("address", "location_lat", "location_lng", "is_active")
    @classmethod
    def _reject_explicit_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("cannot be null — omit the field to leave it unchanged")
        return value

    @model_validator(mode="after")
    def _address_and_coordinates_move_together(self) -> BranchUpdateIn:
        location_fields = {"address", "location_lat", "location_lng"}
        sent = location_fields & self.model_fields_set
        if sent and sent != location_fields:
            raise ValueError("address, locationLat and locationLng must be sent together")
        return self


class BranchResponse(CamelModel):
    branch: BranchOut


class BranchListResponse(CamelModel):
    branches: list[BranchOut]
