"""Settings validation — the production guard on TRIP_SIGNING_SECRET (issue #24)."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.config import Settings

_BASE = {
    "database_url": "postgresql+asyncpg://u:p@localhost:5432/carma",
    "jwt_secret": "x" * 16,
}
_VALID_SECRET = "a" * 32


class TestTripSigningSecretGuard:
    def test_production_without_secret_is_rejected(self) -> None:
        with pytest.raises(ValidationError, match="TRIP_SIGNING_SECRET"):
            Settings(**_BASE, env="production", trip_signing_secret="")

    def test_production_with_short_secret_is_rejected(self) -> None:
        with pytest.raises(ValidationError, match="at least 32 characters"):
            Settings(**_BASE, env="production", trip_signing_secret="a" * 31)

    def test_production_with_valid_secret_is_accepted(self) -> None:
        s = Settings(**_BASE, env="production", trip_signing_secret=_VALID_SECRET)
        assert s.trip_signing_secret == _VALID_SECRET

    @pytest.mark.parametrize("env", ["development", "test"])
    def test_non_production_tolerates_empty_secret(self, env: str) -> None:
        """Dev keeps working unsigned — the bypass is intentional outside production."""
        s = Settings(**_BASE, env=env, trip_signing_secret="")
        assert s.trip_signing_secret == ""
