"""The fraud evidence contract: what the device sends, and what survives the trip to a row.

Two halves. The parsing tests prove the schema now does real work — canonical
names, a bounded score, gates that arrive by name. The persistence test proves
the evidence actually reaches `fraud_reports.detection` instead of being flattened
into an untyped blob, which is the whole point of CAR-32.
"""

from __future__ import annotations

import uuid

import pytest
from pydantic import ValidationError
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import FraudReport, User
from app.models.enums import UserRole
from app.schemas.fraud import InvalidTripPayload
from app.services import fraud as fraud_service

_TRAIN_PAYLOAD = {
    "idempotencyKey": "fraud_u1_2026-08-01T09:00:00.000Z",
    "tripDurationSeconds": 240,
    "distanceKm": 4.8,
    "anomalyFlags": [
        "TRANSPORT_MODE_TRAIN",
        "SIGNAL_CONSTANT_HIGH_SPEED",
        "SIGNAL_NO_LATERAL_FORCE",
        "SIGNAL_NO_HEADING_CHANGE",
    ],
    "detection": {
        "fraudScore": 1.0,
        "detectedMode": "TRAIN",
        "signals": {
            "constantHighSpeed": True,
            "noLateralForce": True,
            "noHeadingChange": True,
        },
        "telemetry": {
            "avgSpeedKmh": 82.4,
            "maxLateralAccelG": 0.03,
            "yawVariance": 0.001,
        },
        "maxSpeedKmh": 96.2,
    },
}


# ─── Parsing ─────────────────────────────────────────────────────────────────


def test_detection_evidence_parses_under_canonical_names() -> None:
    dto = InvalidTripPayload.model_validate(_TRAIN_PAYLOAD)

    assert dto.detection is not None
    assert dto.detection.fraud_score == 1.0
    assert dto.detection.detected_mode == "TRAIN"
    assert dto.detection.telemetry is not None
    assert dto.detection.telemetry.yaw_variance == 0.001
    assert dto.detection.signals is not None
    assert dto.detection.signals.constant_high_speed is True


def test_which_gate_fired_survives_the_wire() -> None:
    """The gates are the diagnostic half — a partial verdict must stay partial."""
    payload = {
        **_TRAIN_PAYLOAD,
        "detection": {
            **_TRAIN_PAYLOAD["detection"],
            "fraudScore": 0.75,
            "signals": {"constantHighSpeed": True, "noLateralForce": True, "noHeadingChange": False},
        },
    }

    signals = InvalidTripPayload.model_validate(payload).detection.signals

    assert (signals.constant_high_speed, signals.no_lateral_force, signals.no_heading_change) == (
        True,
        True,
        False,
    )


@pytest.mark.parametrize("score", [-0.1, 1.4])
def test_out_of_range_score_rejected(score: float) -> None:
    payload = {**_TRAIN_PAYLOAD, "detection": {**_TRAIN_PAYLOAD["detection"], "fraudScore": score}}

    with pytest.raises(ValidationError):
        InvalidTripPayload.model_validate(payload)


def test_pre_trip_rejection_carries_no_distance() -> None:
    """A trip rejected at the start gate was never confirmed, so it has no distance."""
    payload = {k: v for k, v in _TRAIN_PAYLOAD.items() if k != "distanceKm"}

    dto = InvalidTripPayload.model_validate(payload)

    assert dto.distance_km is None
    assert dto.detection is not None  # the evidence still arrives


def test_bare_payload_still_accepted() -> None:
    """Evidence is additive: a client that sends none must not start failing."""
    dto = InvalidTripPayload.model_validate({"anomalyFlags": ["TRANSPORT_MODE_TRAIN"]})

    assert dto.detection is None
    assert dto.anomaly_flags == ["TRANSPORT_MODE_TRAIN"]


# ─── Persistence ─────────────────────────────────────────────────────────────


async def _make_user(db: AsyncSession) -> User:
    user = User(
        email=f"_fraud_{uuid.uuid4().hex[:10]}@carma.test",
        password_hash="x",
        role=UserRole.DRIVER,
        name="Fraud Test",
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@pytest.mark.asyncio
async def test_report_persists_detection_evidence(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    try:
        dto = InvalidTripPayload.model_validate(_TRAIN_PAYLOAD)

        out = await fraud_service.report(db_session, user, dto)

        row = (await db_session.execute(select(FraudReport).where(FraudReport.id == out.id))).scalar_one()
        assert row.distance_km == 4.8
        assert row.detection["fraudScore"] == 1.0
        assert row.detection["signals"]["noHeadingChange"] is True
        assert row.detection["telemetry"]["yawVariance"] == 0.001
        # Absent evidence is absent, not a null — see exclude_none in services/fraud.py
        assert "rawPayload" not in row.detection
        assert "SIGNAL_NO_LATERAL_FORCE" in row.anomaly_flags
    finally:
        await db_session.execute(delete(FraudReport).where(FraudReport.user_id == user.id))
        await db_session.delete(user)
        await db_session.commit()
