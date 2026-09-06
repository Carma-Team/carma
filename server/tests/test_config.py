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


class TestRefreshCookieSecureGuard:
    """`Secure` on the web session cookie (CAR-217) — never optional in production,
    and forced on even earlier if `SameSite=None` is ever chosen, because a
    browser refuses that pairing outright without it."""

    def test_production_is_always_secure(self) -> None:
        s = Settings(**_BASE, env="production", trip_signing_secret=_VALID_SECRET, trusted_proxy_count=1)
        assert s.refresh_cookie_secure is True

    def test_development_with_the_default_samesite_is_not_secure(self) -> None:
        """`http://localhost` has no TLS — a `Secure` cookie here would just never be sent."""
        s = Settings(**_BASE, env="development")
        assert s.refresh_cookie_samesite == "lax"
        assert s.refresh_cookie_secure is False

    def test_samesite_none_forces_secure_even_outside_production(self) -> None:
        s = Settings(**_BASE, env="development", refresh_cookie_samesite="none")
        assert s.refresh_cookie_secure is True


class TestTokenLifetimeGuard:
    """A misconfigured lifetime should fail loudly at startup, not mint broken
    tokens quietly — the same posture `trip_signing_secret` and
    `trusted_proxy_count` already take on this exact class of mistake."""

    def test_zero_web_access_token_minutes_is_rejected(self) -> None:
        with pytest.raises(ValidationError, match="web_access_token_expires_minutes"):
            Settings(**_BASE, web_access_token_expires_minutes=0)

    def test_negative_web_access_token_minutes_is_rejected(self) -> None:
        with pytest.raises(ValidationError, match="web_access_token_expires_minutes"):
            Settings(**_BASE, web_access_token_expires_minutes=-1)

    def test_zero_refresh_token_days_is_rejected(self) -> None:
        with pytest.raises(ValidationError, match="refresh_token_expires_days"):
            Settings(**_BASE, refresh_token_expires_days=0)

    def test_negative_refresh_token_days_is_rejected(self) -> None:
        with pytest.raises(ValidationError, match="refresh_token_expires_days"):
            Settings(**_BASE, refresh_token_expires_days=-1)

    def test_an_access_token_that_would_outlive_its_refresh_token_is_rejected(self) -> None:
        """Not just each bound on its own — the pair the wrong way round defeats
        the whole point of the split (see `_validate_token_lifetimes`). Two full
        days for the access token against one day of refresh-token life —
        both individually positive, but the wrong way round."""
        with pytest.raises(ValidationError, match="WEB_ACCESS_TOKEN_EXPIRES_MINUTES"):
            Settings(**_BASE, web_access_token_expires_minutes=2 * 24 * 60, refresh_token_expires_days=1)

    def test_an_access_token_exactly_as_long_as_its_refresh_token_is_rejected(self) -> None:
        """Equal is still "does not outlive" in name only — a token that expires
        the same instant its session does buys the split nothing."""
        with pytest.raises(ValidationError, match="WEB_ACCESS_TOKEN_EXPIRES_MINUTES"):
            Settings(**_BASE, web_access_token_expires_minutes=24 * 60, refresh_token_expires_days=1)

    def test_the_defaults_are_valid(self) -> None:
        """Pins the shipped defaults against ever silently regressing into an
        invalid pair."""
        s = Settings(**_BASE)
        assert s.web_access_token_expires_minutes == 15
        assert s.refresh_token_expires_days == 30

    def test_a_short_access_token_against_a_long_refresh_token_is_accepted(self) -> None:
        s = Settings(**_BASE, web_access_token_expires_minutes=15, refresh_token_expires_days=30)
        assert s.web_access_token_expires_minutes == 15


class TestRecordingStoreGuard:
    """CAR-213. The alternative to failing here is a store that only turns out to
    be unusable at the first upload, after the tester has already driven."""

    def test_azure_without_a_connection_string_is_rejected(self) -> None:
        with pytest.raises(ValidationError, match="RECORDING_BLOB_CONNECTION_STRING"):
            Settings(**_BASE, recording_store="azure")

    def test_azure_with_a_connection_string_is_accepted(self) -> None:
        s = Settings(**_BASE, recording_store="azure", recording_blob_connection_string="UseDevelopmentStorage=true")
        assert s.recording_store == "azure"

    def test_local_is_the_default(self) -> None:
        assert Settings(**_BASE).recording_store == "local"
