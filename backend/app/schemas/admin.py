import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, SecretStr, StringConstraints

from app.schemas.auth import RequestModel

Reason = Annotated[str, StringConstraints(strip_whitespace=True, min_length=5, max_length=500)]


class AdminVerify(RequestModel):
    password: SecretStr


class AdminAction(RequestModel):
    reason: Reason


class AdminSessionState(BaseModel):
    verified: bool


class AdminOrganisation(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    country_code: str
    status: str
    created_at: datetime
    members: int
    vehicles: int
    plan: str | None
    paid_until: datetime | None


class AdminOrganisationList(BaseModel):
    items: list[AdminOrganisation]
    total: int
    page: int
    page_size: int


class AdminUser(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str
    is_active: bool
    is_platform_admin: bool
    email_verified: bool
    last_login_at: datetime | None
    created_at: datetime
    organisations: int


class AdminUserList(BaseModel):
    items: list[AdminUser]
    total: int
    page: int
    page_size: int


class AdminAuditEntry(BaseModel):
    id: uuid.UUID
    occurred_at: datetime
    action: str
    organisation_id: uuid.UUID | None
    actor_user_id: uuid.UUID | None
    actor_email: str | None
    entity_type: str | None
    entity_id: str | None
    details: dict[str, Any]


class AdminAuditList(BaseModel):
    items: list[AdminAuditEntry]
    total: int
    page: int
    page_size: int


class ServiceCheck(BaseModel):
    name: str
    state: Literal["ok", "unavailable", "not_configured"]


class JobState(BaseModel):
    name: str
    state: Literal["ok", "late", "never", "unknown"]
    last_success_at: datetime | None


class IntegrationState(BaseModel):
    name: str
    # Configured means settings exist, and doesn't mean it has been proven to work.
    state: Literal["configured", "not_configured"]
    detail: str


class SystemCounts(BaseModel):
    organisations: int
    users: int
    vehicles: int
    active_subscriptions: int
    emails_waiting: int
    emails_failed: int
    automation_failed: int
    active_gps_feeds: int


class AdminSystem(BaseModel):
    services: list[ServiceCheck]
    jobs: list[JobState]
    integrations: list[IntegrationState]
    counts: SystemCounts
