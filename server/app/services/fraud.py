from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.fraud import FraudReport
from app.models.user import User
from app.schemas.fraud import FraudReportOut, InvalidTripPayload


async def report(db: AsyncSession, user: User, dto: InvalidTripPayload) -> FraudReportOut:
    fraud_report = FraudReport(
        user_id=user.id,
        idempotency_key=dto.idempotency_key,
        trip_duration_seconds=dto.trip_duration_seconds,
        distance_km=dto.distance_km,
        avg_score=dto.avg_score,
        anomaly_flags=dto.anomaly_flags if dto.anomaly_flags else [],
        raw_payload=dto.raw_payload,
    )
    db.add(fraud_report)
    await db.commit()
    await db.refresh(fraud_report)
    return FraudReportOut(
        id=fraud_report.id,
        user_id=fraud_report.user_id,
        reported_at=fraud_report.reported_at,
        anomaly_flags=fraud_report.anomaly_flags or [],
    )
