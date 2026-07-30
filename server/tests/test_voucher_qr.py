"""Guards the voucher → QR-code data chain.

Covers the two things most likely to silently break the scannable QR in the app:
  1. random_voucher_code() must always emit a non-empty, QR/URL-safe, unique string.
  2. VoucherOut wire mapping must put the code in `code`/`qrData`, and `qrData`
     must fall back to the code when no dedicated qr_data payload exists.

Pure unit tests — no DB, no live server (matches the in-process test style).
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from types import SimpleNamespace

from app.core.security import random_voucher_code
from app.schemas.reward import VoucherOut

QR_SAFE = re.compile(r"[A-Z0-9]+")


def test_random_voucher_code_is_qr_safe_and_unique() -> None:
    codes = [random_voucher_code() for _ in range(2000)]
    assert all(codes), "voucher code must never be empty (empty QR would crash the modal)"
    assert all(1 <= len(c) <= 16 for c in codes), "code must fit the String(64) column with margin"
    assert all(QR_SAFE.fullmatch(c) for c in codes), "code must be A-Z0-9 only (QR/URL safe)"
    assert len(set(codes)) == len(codes), "codes must be unique (qr_code column is UNIQUE)"


def _fake_redemption(*, qr_code: str, qr_data: str | None, status: str = "PENDING") -> SimpleNamespace:
    business = SimpleNamespace(name="Paz", name_he="פז")
    reward = SimpleNamespace(
        id="rwd-1",
        business_id="biz-1",
        business=business,
        title_he="הנחה בתדלוק",
        title_en="Fuel discount",
        description_he="תיאור",
        description_en="desc",
        category=SimpleNamespace(value="FUEL"),
        cost_points=50,
        image_icon="car",
        is_active=True,
        stock=10,
        expires_at=None,
    )
    return SimpleNamespace(
        id="vch-1",
        user_id="usr-1",
        reward_id="rwd-1",
        qr_code=qr_code,
        qr_data=qr_data,
        status=SimpleNamespace(value=status),
        expires_at=datetime(2026, 6, 15, tzinfo=UTC),
        used_at=None,
        created_at=datetime(2026, 6, 15, tzinfo=UTC),
        reward=reward,
    )


def test_voucher_out_maps_code_and_qr_data() -> None:
    v = VoucherOut.from_orm_redemption(_fake_redemption(qr_code="ABC123", qr_data="PAYLOAD-XYZ"), None)
    assert v.code == "ABC123", "code must come from qr_code"
    assert v.qr_data == "PAYLOAD-XYZ", "qrData must carry the dedicated scan payload when present"


def test_voucher_out_qr_data_falls_back_to_code() -> None:
    # When no dedicated payload exists, the QR (which now renders qrData) must
    # still resolve to the human code so the voucher stays scannable.
    v = VoucherOut.from_orm_redemption(_fake_redemption(qr_code="ABC123", qr_data=None), None)
    assert v.qr_data == "ABC123", "qrData must fall back to qr_code"
    assert v.code == v.qr_data, "with no separate payload, code and qrData must match"


def test_voucher_out_derives_status_and_is_used() -> None:
    pending = VoucherOut.from_orm_redemption(_fake_redemption(qr_code="A", qr_data="A"), None)
    assert pending.status == "pending" and pending.is_used is False

    used = VoucherOut.from_orm_redemption(_fake_redemption(qr_code="A", qr_data="A", status="USED"), None)
    assert used.status == "used", "wire status must be lower-cased"
    assert used.is_used is True, "isUsed must be True once the voucher is redeemed"
