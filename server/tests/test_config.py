"""Settings validation — the production guards on signing and on proxy depth."""

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
        # `trusted_proxy_count` is the other production guard — see the class below.
        s = Settings(**_BASE, env="production", trip_signing_secret=_VALID_SECRET, trusted_proxy_count=1)
        assert s.trip_signing_secret == _VALID_SECRET

    @pytest.mark.parametrize("env", ["development", "test"])
    def test_non_production_tolerates_empty_secret(self, env: str) -> None:
        """Dev keeps working unsigned — the bypass is intentional outside production."""
        s = Settings(**_BASE, env=env, trip_signing_secret="")
        assert s.trip_signing_secret == ""


class TestTrustedProxyCountGuard:
    """Production behind an ingress must say so, or rate limiting silently breaks.

    Left at 0, every request is counted against the ingress address: the whole
    user base lands in one bucket and the app stops answering for everybody at
    30 requests a minute. Nothing logs an error — it just looks like an outage.
    """

    def test_production_without_a_proxy_count_is_rejected(self) -> None:
        with pytest.raises(ValidationError, match="TRUSTED_PROXY_COUNT"):
            Settings(**_BASE, env="production", trip_signing_secret=_VALID_SECRET, trusted_proxy_count=0)

    def test_production_with_a_proxy_count_is_accepted(self) -> None:
        s = Settings(**_BASE, env="production", trip_signing_secret=_VALID_SECRET, trusted_proxy_count=1)
        assert s.trusted_proxy_count == 1

    @pytest.mark.parametrize("env", ["development", "test"])
    def test_non_production_defaults_to_no_proxy(self, env: str) -> None:
        """Nothing sits in front of a local server, so the header stays untrusted."""
        s = Settings(**_BASE, env=env)
        assert s.trusted_proxy_count == 0
