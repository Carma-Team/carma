"""_redact_span_path masks voucher and invite codes before a span is exported (CAR-129)."""

from __future__ import annotations

from unittest.mock import MagicMock

from app.monitoring import _redact_span_path


def _span() -> MagicMock:
    span = MagicMock()
    span.is_recording.return_value = True
    return span


def test_voucher_path_is_redacted() -> None:
    span = _span()
    _redact_span_path(span, {"path": "/api/business/vouchers/ABC123XYZ/redeem"})

    span.set_attribute.assert_any_call("http.target", "/api/business/vouchers/***/redeem")
    span.set_attribute.assert_any_call("url.full", "/api/business/vouchers/***/redeem")


def test_invite_path_is_redacted() -> None:
    span = _span()
    _redact_span_path(span, {"path": "/api/invites/ABC123XY/redeem"})

    span.set_attribute.assert_any_call("http.target", "/api/invites/***/redeem")


def test_unrelated_path_is_untouched() -> None:
    span = _span()
    _redact_span_path(span, {"path": "/api/business/rewards"})

    span.set_attribute.assert_not_called()


def test_non_recording_span_is_skipped() -> None:
    span = _span()
    span.is_recording.return_value = False
    _redact_span_path(span, {"path": "/api/business/vouchers/ABC123XYZ"})

    span.set_attribute.assert_not_called()
