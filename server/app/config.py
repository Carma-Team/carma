from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    env: Literal["development", "test", "production"] = "development"
    host: str = "0.0.0.0"
    port: int = 3000

    database_url: str = Field(min_length=10)

    jwt_secret: str = Field(min_length=16)
    jwt_expires_minutes: int = 60 * 24 * 7

    # The web app's access token, minted by `/api/auth/refresh` — deliberately
    # shorter than `jwt_expires_minutes`. It lives in browser memory only
    # (never localStorage), and that only buys anything if a token that leaks
    # stops being useful quickly; a 7-day token sitting in a tab's memory would
    # make the split from the refresh cookie mostly theatre. Mobile is
    # unaffected — it keeps minting tokens at `jwt_expires_minutes` via
    # `/api/auth/login`.
    web_access_token_expires_minutes: int = 15
    # How long a browser session survives with no activity at all. Long on
    # purpose — CAR-217 is a pilot and asked for a session that does not make
    # a business owner sign in again mid-week. Each successful refresh rotates
    # the cookie and resets this window, so an active user is never signed out
    # by it; only real inactivity is.
    refresh_token_expires_days: int = 30
    # "lax" is correct today — the web app and the API are same-site in every
    # environment this runs in so far. If a future deploy puts them on
    # different registrable domains, the browser will silently stop sending
    # the cookie on fetch/XHR unless this becomes "none" (which also requires
    # `refresh_cookie_secure`, see below — HTTPS only, no exception for dev).
    refresh_cookie_samesite: Literal["lax", "strict", "none"] = "lax"

    otp_length: int = 6
    otp_ttl_seconds: int = 300
    # Failures on either door — wrong password or wrong code — before the account
    # closes to *everyone*, including whoever is holding a valid session. This is
    # the backstop against a guesser spread across many addresses, not the main
    # control: that is the per-address backoff below, which costs the guesser
    # instead of the account's owner.
    #
    # 100 is the most NIST SP 800-63B §5.2.2 allows — "no more than 100
    # consecutive failed attempts", a ceiling rather than a floor. At 10, anyone
    # who knew a driver's email could take that driver offline at will (CAR-51).
    account_lockout_after: int = 100
    otp_lockout_seconds: int = 900
    # Failures from one address against one account before that address starts
    # waiting. Auth0 counts per (identifier, IP) by default for this reason, and
    # Cognito starts backing a caller off at 5.
    login_backoff_after: int = 5
    # The wait doubles with each further failure from that address — 1s, 2s, 4s —
    # up to this ceiling.
    login_backoff_max_seconds: int = 900
    # How far back failures are counted, for the per-address backoff and the
    # account-wide ceiling alike. The same rolling hour `otp_max_per_hour` uses.
    login_failure_window_seconds: int = 3600
    # Codes one phone number may trigger per hour — login, registration and
    # password reset share the one budget, because all three send.
    # Every code is a billed SMS, so the destination number is the budget line.
    otp_max_per_hour: int = 5

    sms_provider: Literal["console", "twilio"] = "console"
    twilio_account_sid: str | None = None
    twilio_auth_token: str | None = None
    twilio_from_number: str | None = None

    applicationinsights_connection_string: str | None = None
    cors_origins: str = "*"

    # How many reverse proxies sit in front of the app. Behind Azure Container
    # Apps this is 1 (its ingress). 0 means "no proxy" — read the socket peer.
    # See `core.limiter.client_ip` for why the count matters rather than a bool.
    trusted_proxy_count: int = Field(default=0, ge=0, le=4)

    # Base of the invite links users share. Must be a host that serves the App
    # Links / Universal Links well-known files, or the link opens a browser
    # instead of the app.
    invite_base_url: str = "https://carma.app"
    trip_signing_secret: str = Field(default="", min_length=0)

    @field_validator("cors_origins")
    @classmethod
    def _normalise_origins(cls, v: str) -> str:
        return v.strip() or "*"

    @model_validator(mode="after")
    def _validate_signing_secret(self) -> Settings:
        """Refuse to start a production server that cannot enforce trip signatures.

        An empty secret makes `_verify_signature` a no-op (trips.py), so the scoring
        oracle would silently accept any payload — the integrity gate in
        docs/fraud-detection.md would pass without settling anything. That is
        acceptable in dev, which is how the app runs today; shipping it to production
        fails loudly at startup instead.
        """
        if self.env != "production":
            return self
        if not self.trip_signing_secret:
            raise ValueError("ENV=production requires TRIP_SIGNING_SECRET to be set")
        if len(self.trip_signing_secret) < 32:
            raise ValueError("TRIP_SIGNING_SECRET must be at least 32 characters")
        return self

    @model_validator(mode="after")
    def _validate_proxy_count(self) -> Settings:
        """Production runs behind an ingress, so leaving the count at 0 is a bug.

        Every request would then be counted against the ingress address and the
        whole user base would share one rate-limit bucket — 30 requests a minute
        for everyone, together. Silent, and indistinguishable from an outage.
        """
        if self.env == "production" and self.trusted_proxy_count == 0:
            raise ValueError(
                "ENV=production requires TRUSTED_PROXY_COUNT to be set "
                "(1 behind Azure Container Apps ingress) — see core/limiter.py"
            )
        return self

    @model_validator(mode="after")
    def _validate_twilio(self) -> Settings:
        if self.sms_provider == "twilio":
            missing = [
                k
                for k, v in {
                    "TWILIO_ACCOUNT_SID": self.twilio_account_sid,
                    "TWILIO_AUTH_TOKEN": self.twilio_auth_token,
                    "TWILIO_FROM_NUMBER": self.twilio_from_number,
                }.items()
                if not v
            ]
            if missing:
                raise ValueError(f"SMS_PROVIDER=twilio requires {', '.join(missing)}")
        return self

    @property
    def cors_origin_list(self) -> list[str]:
        if self.cors_origins == "*":
            return ["*"]
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def cors_allows_credentials(self) -> bool:
        """False while origins are a wildcard — the CORS spec forbids the pair.

        The mobile app never sends a cross-origin request, so this only affects
        browser tooling. Naming an explicit origin list turns it back on.
        """
        return self.cors_origin_list != ["*"]

    @property
    def refresh_cookie_secure(self) -> bool:
        """`Secure` in production always; earlier too if SameSite=None is chosen.

        Browsers reject a `SameSite=None` cookie outright unless it also
        carries `Secure` — so this cannot be left for `env == "production"`
        alone without a deploy that sets `refresh_cookie_samesite=none` on a
        non-production box quietly losing every session.
        """
        return self.env == "production" or self.refresh_cookie_samesite == "none"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
