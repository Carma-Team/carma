from __future__ import annotations

import enum

from pydantic import Field

from app.schemas._base import CamelModel


class OccupancyVerdict(str, enum.Enum):
    """driver-identification.md §3.2. Only DRIVER and PASSENGER are reachable through the
    declaration endpoint; UNKNOWN is the pre-declaration read (§4 of the plan on CAR-220).
    """

    DRIVER = "DRIVER"
    PASSENGER = "PASSENGER"
    UNKNOWN = "UNKNOWN"


class OccupancySource(str, enum.Enum):
    """driver-identification.md §3.2, human sources only — COTRAVEL and CLASSIFIER are
    Phase 2+ and have no writer yet.
    """

    DECLARED = "DECLARED"
    ANSWERED = "ANSWERED"


class OccupancyDeclarationIn(CamelModel):
    """User-submitted. `was_driving=False` is the passenger declaration."""

    was_driving: bool
    prompted: bool = Field(description="True when answering a flag prompt, False when volunteered unprompted.")


class OccupancyOut(CamelModel):
    """Deliberately narrower than the full OccupancyRecord (driver-identification.md §3.3) —
    never exposes co_travel, likelihood, signals, or calibration_version to the client.
    """

    trip_id: str
    verdict: OccupancyVerdict
    excluded_from_driver_score: bool
    points_reversed: float
    appeal_available: bool
