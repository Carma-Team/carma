from __future__ import annotations

from datetime import datetime

from pydantic import EmailStr, Field

from app.models.enums import Language, UserRole
from app.schemas._base import CamelModel


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
    total_distance: float
    level: int
    is_private: bool = False
    drive_mode_enabled: bool
    bluetooth_device_id: str | None = None
    bluetooth_device_name: str | None = None
    created_at: datetime


class UpdateProfileIn(CamelModel):
    name: str | None = Field(default=None, min_length=2, max_length=80)
    language: Language | None = None
    age: int | None = Field(default=None, ge=16, le=120)
    city: str | None = Field(default=None, max_length=80)
    is_private: bool | None = None


class UpdateLocationIn(CamelModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
