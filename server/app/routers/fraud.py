from __future__ import annotations

from fastapi import APIRouter, status

from app.core.deps import CurrentUser, DbSession
from app.schemas.fraud import FraudReportOut, InvalidTripPayload
from app.services import fraud as fraud_service

router = APIRouter(prefix="/api/fraud", tags=["fraud"])


@router.post(
    "",
    response_model=FraudReportOut,
    response_model_by_alias=True,
    status_code=status.HTTP_201_CREATED,
    summary="Ingest an invalid trip payload for fraud analysis",
)
async def report_fraud(dto: InvalidTripPayload, user: CurrentUser, db: DbSession) -> FraudReportOut:
    return await fraud_service.report(db, user, dto)
