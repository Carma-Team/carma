from __future__ import annotations

import enum


class UserRole(str, enum.Enum):
    DRIVER = "DRIVER"
    BUSINESS = "BUSINESS"
    ADMIN = "ADMIN"


class Language(str, enum.Enum):
    HE = "HE"
    EN = "EN"


class TripStatus(str, enum.Enum):
    ACTIVE = "ACTIVE"
    COMPLETED = "COMPLETED"
    DISCARDED = "DISCARDED"


class EventType(str, enum.Enum):
    HARD_BRAKE = "HARD_BRAKE"
    AGGRESSIVE_ACCEL = "AGGRESSIVE_ACCEL"
    SHARP_TURN = "SHARP_TURN"
    SWERVE = "SWERVE"
    PHONE_USE = "PHONE_USE"
    SPEEDING = "SPEEDING"


class RedemptionStatus(str, enum.Enum):
    PENDING = "PENDING"
    USED = "USED"
    EXPIRED = "EXPIRED"
    CANCELLED = "CANCELLED"


class BusinessCategory(str, enum.Enum):
    FUEL = "FUEL"
    FOOD = "FOOD"
    ECO = "ECO"
    ENTERTAINMENT = "ENTERTAINMENT"
    SHOPPING = "SHOPPING"
    OTHER = "OTHER"


class FriendStatus(str, enum.Enum):
    PENDING = "PENDING"
    ACCEPTED = "ACCEPTED"
    BLOCKED = "BLOCKED"
