import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import CheckConstraint, ForeignKeyConstraint, Index, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field

from app.models.base import TIMESTAMPTZ, TenantOwned, Timestamps, UUIDPrimaryKey, enum_type, utcnow
from app.models.enums import (
    AlertSeverity,
    AlertType,
    AutomationRunStatus,
    EmailMode,
    NotificationEmailStatus,
)


class Notification(UUIDPrimaryKey, TenantOwned, table=True):
    __tablename__ = "notifications"
    __table_args__ = (
        ForeignKeyConstraint(
            ["organisation_id", "alert_id"], ["alerts.organisation_id", "alerts.id"]
        ),
        # Delivery runs at least once, so this is what stops anyone being told twice.
        UniqueConstraint("user_id", "alert_id"),
        Index("ix_notifications_user_id_created_at", "user_id", "created_at"),
        Index(
            "ix_notifications_email_due",
            "organisation_id",
            "next_email_at",
            postgresql_where=text("email_status = 'pending'"),
        ),
    )

    user_id: uuid.UUID = Field(foreign_key="users.id")
    alert_id: uuid.UUID
    title: str = Field(max_length=255)
    body: str = Field(max_length=1000)
    severity: AlertSeverity = Field(sa_type=enum_type(AlertSeverity, "severity"))
    show_in_app: bool = Field(default=True)
    read_at: datetime | None = Field(default=None, sa_type=TIMESTAMPTZ)
    email_status: NotificationEmailStatus = Field(
        default=NotificationEmailStatus.NOT_REQUESTED,
        sa_type=enum_type(NotificationEmailStatus, "email_status"),
    )
    email_attempts: int = Field(default=0)
    next_email_at: datetime | None = Field(default=None, sa_type=TIMESTAMPTZ)
    created_at: datetime = Field(default_factory=utcnow, sa_type=TIMESTAMPTZ, nullable=False)


class NotificationPreference(UUIDPrimaryKey, TenantOwned, Timestamps, table=True):
    """Only exists where someone has changed the default for a type of alert."""

    __tablename__ = "notification_preferences"
    __table_args__ = (UniqueConstraint("organisation_id", "user_id", "alert_type"),)

    user_id: uuid.UUID = Field(foreign_key="users.id")
    alert_type: AlertType = Field(sa_type=enum_type(AlertType, "alert_type"))
    in_app: bool = Field(default=True)
    email_mode: EmailMode = Field(
        default=EmailMode.CRITICAL, sa_type=enum_type(EmailMode, "email_mode")
    )


class AutomationRule(UUIDPrimaryKey, TenantOwned, Timestamps, table=True):
    """Chosen from fixed triggers, conditions and actions. No user-supplied code ever runs."""

    __tablename__ = "automation_rules"
    __table_args__ = (
        UniqueConstraint("organisation_id", "id"),
        ForeignKeyConstraint(
            ["organisation_id", "vehicle_id"], ["vehicles.organisation_id", "vehicles.id"]
        ),
        Index(
            "uq_automation_rules_organisation_id_name_active",
            "organisation_id",
            "name",
            unique=True,
            postgresql_where=text("archived_at IS NULL"),
        ),
    )

    name: str = Field(max_length=120)
    is_enabled: bool = Field(default=True)
    # Trigger: an alert of any of these types.
    alert_types: list[str] = Field(default_factory=list, sa_type=JSONB)
    # Conditions.
    min_severity: AlertSeverity = Field(
        default=AlertSeverity.INFO, sa_type=enum_type(AlertSeverity, "min_severity")
    )
    vehicle_id: uuid.UUID | None = Field(default=None)
    # Actions, validated against a fixed list. See schemas/notifications.py.
    actions: list[dict[str, Any]] = Field(default_factory=list, sa_type=JSONB)
    created_by_user_id: uuid.UUID | None = Field(default=None, foreign_key="users.id")
    archived_at: datetime | None = Field(default=None, sa_type=TIMESTAMPTZ)


class AutomationRun(UUIDPrimaryKey, TenantOwned, table=True):
    """Execution history. One per rule and alert, so a retry can't repeat what already worked."""

    __tablename__ = "automation_runs"
    __table_args__ = (
        ForeignKeyConstraint(
            ["organisation_id", "rule_id"],
            ["automation_rules.organisation_id", "automation_rules.id"],
        ),
        ForeignKeyConstraint(
            ["organisation_id", "alert_id"], ["alerts.organisation_id", "alerts.id"]
        ),
        UniqueConstraint("rule_id", "alert_id"),
        Index("ix_automation_runs_rule_id_created_at", "rule_id", "created_at"),
        Index(
            "ix_automation_runs_due",
            "organisation_id",
            "next_attempt_at",
            postgresql_where=text("status = 'pending'"),
        ),
        CheckConstraint("attempts >= 0", name="attempts_not_negative"),
    )

    rule_id: uuid.UUID
    alert_id: uuid.UUID
    status: AutomationRunStatus = Field(
        default=AutomationRunStatus.PENDING, sa_type=enum_type(AutomationRunStatus, "status")
    )
    attempts: int = Field(default=0)
    next_attempt_at: datetime | None = Field(default=None, sa_type=TIMESTAMPTZ)
    # A short, fixed reason. Never raw exception text, which could hold personal data.
    outcome: str | None = Field(default=None, max_length=255)
    created_at: datetime = Field(default_factory=utcnow, sa_type=TIMESTAMPTZ, nullable=False)
    finished_at: datetime | None = Field(default=None, sa_type=TIMESTAMPTZ)
