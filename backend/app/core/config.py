from functools import lru_cache
from pathlib import Path
from typing import Literal, Self

from pydantic import Field, PostgresDsn, RedisDsn, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT_ENV_FILE = Path(__file__).resolve().parents[3] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="FLEETPULSE_",
        env_file=ROOT_ENV_FILE,
        extra="ignore",
    )

    environment: Literal["development", "test", "staging", "production"] = "development"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"

    database_url: PostgresDsn
    # Owner account, for migrations and role provisioning only. Never used by the running app.
    migration_database_url: PostgresDsn | None = None
    redis_url: RedisDsn
    cors_origins: list[str] = []
    frontend_base_url: str = "http://localhost:3210"

    jwt_secret: SecretStr = Field(min_length=32)
    jwt_issuer: str = "fleetpulse"
    jwt_audience: str = "fleetpulse-api"
    access_token_minutes: int = Field(default=15, gt=0)
    refresh_token_days: int = Field(default=14, gt=0)
    session_max_days: int = Field(default=90, gt=0)
    # A consumed refresh token seen again this soon is a race between tabs, not theft.
    refresh_reuse_grace_seconds: int = Field(default=10, ge=0)
    email_verification_hours: int = Field(default=24, gt=0)
    password_reset_minutes: int = Field(default=30, gt=0)

    cookie_samesite: Literal["lax", "strict"] = "lax"
    cookie_domain: str | None = None

    # Per email and IP together, so someone elsewhere can't lock the real user out.
    login_max_failures_per_email_ip: int = Field(default=10, gt=0)
    # Per email from anywhere: a higher ceiling that stops distributed guessing.
    login_max_failures_per_email: int = Field(default=100, gt=0)
    login_max_failures_per_ip: int = Field(default=50, gt=0)
    login_failure_window_seconds: int = Field(default=900, gt=0)
    auth_requests_per_hour_per_ip: int = Field(default=30, gt=0)
    auth_emails_per_hour_per_address: int = Field(default=5, gt=0)
    # Floor on response time for endpoints whose work differs when an account exists.
    auth_min_response_ms: int = Field(default=400, ge=0)
    invitation_days: int = Field(default=7, gt=0)
    invitations_per_hour_per_org: int = Field(default=50, gt=0)
    organisations_per_hour_per_user: int = Field(default=5, gt=0)

    # Google sign-in is off until both are set. The API's own public address builds the callback.
    google_client_id: str | None = None
    google_client_secret: SecretStr | None = None
    api_public_url: str = "http://localhost:8010"

    # Off by default: simulated positions must be an explicit choice, and are always labelled.
    gps_simulator_enabled: bool = False
    gps_stale_minutes: int = Field(default=15, gt=0)
    gps_offline_minutes: int = Field(default=1440, gt=0)
    gps_stream_recheck_seconds: float = Field(default=60, gt=0)
    gps_journey_gap_minutes: int = Field(default=10, gt=0)
    gps_max_position_age_days: int = Field(default=30, gt=0)
    gps_max_future_seconds: int = Field(default=300, ge=0)
    gps_requests_per_minute: int = Field(default=600, gt=0)
    telemetry_retention_months: int = Field(default=13, gt=0)

    # Any S3-compatible service. Files stay private and are reached through signed links.
    storage_endpoint_url: str | None = None
    # The address browsers use, if it differs from the one the API uses.
    storage_public_url: str | None = None
    storage_bucket: str | None = None
    storage_region: str = "us-east-1"
    storage_access_key: str | None = None
    storage_secret_key: SecretStr | None = None
    storage_link_seconds: int = Field(default=300, gt=0, le=3600)

    # Billing stays off until a provider is configured, and limits until enforcement is chosen.
    paystack_secret_key: SecretStr | None = None
    billing_currency: str = Field(default="USD", pattern=r"^[A-Z]{3}$")
    billing_enforced: bool = False

    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: SecretStr | None = None
    smtp_starttls: bool = False
    email_from: str = "FleetPulse <no-reply@fleetpulse.local>"
    contact_inbox_email: str | None = None
    contact_messages_per_hour_per_ip: int = Field(default=5, gt=0)

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def google_enabled(self) -> bool:
        return bool(self.google_client_id and self.google_client_secret)

    @property
    def google_redirect_uri(self) -> str:
        return f"{self.api_public_url}/api/v1/auth/google/callback"

    @property
    def cookie_secure(self) -> bool:
        return self.environment in ("staging", "production")

    @model_validator(mode="after")
    def validate_cors_origins(self) -> Self:
        for origin in self.cors_origins:
            if "*" in origin:
                raise ValueError("CORS origins must be exact; wildcards are not allowed")
            if self.is_production and not origin.startswith("https://"):
                raise ValueError("Production CORS origins must use https")
        return self

    @model_validator(mode="after")
    def validate_production_requirements(self) -> Self:
        if self.is_production:
            if self.redis_url.password is None:
                raise ValueError("Production requires a password in redis_url")
            if not self.frontend_base_url.startswith("https://"):
                raise ValueError("Production frontend_base_url must use https")
            if self.billing_enforced and (
                self.paystack_secret_key is None or not self.paystack_secret_key.get_secret_value()
            ):
                raise ValueError("Enforcing plan limits requires a way for customers to pay")
            if not (
                self.storage_endpoint_url
                and self.storage_bucket
                and self.storage_access_key
                and self.storage_secret_key
                and self.storage_secret_key.get_secret_value()
            ):
                raise ValueError("Production requires private file storage")
            if not self.smtp_host:
                raise ValueError("Production requires smtp_host: auth emails must be deliverable")
            if self.google_enabled and not self.api_public_url.startswith("https://"):
                raise ValueError("Production Google sign-in requires an https api_public_url")
            if self.gps_simulator_enabled:
                raise ValueError("The GPS simulator must be off in production")
            if not self.contact_inbox_email:
                raise ValueError("Production requires contact_inbox_email")
            if not self.smtp_starttls:
                raise ValueError("Production requires smtp_starttls")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
