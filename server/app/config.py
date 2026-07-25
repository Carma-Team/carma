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

    otp_length: int = 6
    otp_ttl_seconds: int = 300
    otp_max_attempts: int = 5
    otp_lockout_seconds: int = 900

    sms_provider: Literal["console", "twilio"] = "console"
    twilio_account_sid: str | None = None
    twilio_auth_token: str | None = None
    twilio_from_number: str | None = None

    applicationinsights_connection_string: str | None = None
    cors_origins: str = "*"
    trip_signing_secret: str = Field(default="", min_length=0)

    @field_validator("cors_origins")
    @classmethod
    def _normalise_origins(cls, v: str) -> str:
        return v.strip() or "*"

    @model_validator(mode="after")
    def _validate_signing_secret(self) -> Settings:
        """Refuse to start a production server that cannot enforce trip signatures.

        An empty secret makes `_verify_signature` a no-op (trips.py), so the scoring
        oracle would silently accept any payload. That is acceptable in dev — it is
        how the app runs today — but shipping it to production is the accident
        RFC-001 §5 warns about, so it fails loudly at startup instead.
        """
        if self.env != "production":
            return self
        if not self.trip_signing_secret:
            raise ValueError("ENV=production requires TRIP_SIGNING_SECRET to be set")
        if len(self.trip_signing_secret) < 32:
            raise ValueError("TRIP_SIGNING_SECRET must be at least 32 characters")
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


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
