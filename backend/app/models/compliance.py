import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import CheckConstraint, ForeignKeyConstraint, Index, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field

from app.models.base import TIMESTAMPTZ, TenantOwned, Timestamps, UUIDPrimaryKey, enum_type
from app.models.enums import DefectSeverity, DefectStatus, DocumentType, InspectionOutcome


class ComplianceDocument(UUIDPrimaryKey, TenantOwned, Timestamps, table=True):
    """Insurance, roadworthiness, licences and the like, for one vehicle or one driver."""

    __tablename__ = "compliance_documents"
    __table_args__ = (
        ForeignKeyConstraint(
            ["organisation_id", "vehicle_id"], ["vehicles.organisation_id", "vehicles.id"]
        ),
        ForeignKeyConstraint(
            ["organisation_id", "driver_id"], ["drivers.organisation_id", "drivers.id"]
        ),
        ForeignKeyConstraint(
            ["organisation_id", "file_id"], ["stored_files.organisation_id", "stored_files.id"]
        ),
        CheckConstraint("num_nonnulls(vehicle_id, driver_id) = 1", name="one_owner"),
        CheckConstraint(
            "issued_on IS NULL OR expires_on IS NULL OR expires_on >= issued_on",
            name="expires_after_issue",
        ),
        Index("ix_compliance_documents_vehicle_id", "vehicle_id"),
        Index("ix_compliance_documents_driver_id", "driver_id"),
        Index(
            "ix_compliance_documents_organisation_id_expires_on",
            "organisation_id",
            "expires_on",
            postgresql_where=text("archived_at IS NULL"),
        ),
    )

    vehicle_id: uuid.UUID | None = Field(default=None)
    driver_id: uuid.UUID | None = Field(default=None)
    document_type: DocumentType = Field(sa_type=enum_type(DocumentType, "document_type"))
    title: str = Field(max_length=160)
    reference_number: str | None = Field(default=None, max_length=100)
    issued_on: date | None = Field(default=None)
    expires_on: date | None = Field(default=None)
    file_id: uuid.UUID | None = Field(default=None)
    notes: str | None = Field(default=None, max_length=2000)
    created_by_user_id: uuid.UUID | None = Field(default=None, foreign_key="users.id")
    archived_at: datetime | None = Field(default=None, sa_type=TIMESTAMPTZ)


class InspectionTemplate(UUIDPrimaryKey, TenantOwned, Timestamps, table=True):
    __tablename__ = "inspection_templates"
    __table_args__ = (
        UniqueConstraint("organisation_id", "id"),
        Index(
            "uq_inspection_templates_organisation_id_name_active",
            "organisation_id",
            "name",
            unique=True,
            postgresql_where=text("archived_at IS NULL"),
        ),
    )

    name: str = Field(max_length=120)
    # [{"id": ..., "label": ..., "critical": bool}]. A failed critical item stops the vehicle.
    items: list[dict[str, Any]] = Field(default_factory=list, sa_type=JSONB)
    created_by_user_id: uuid.UUID | None = Field(default=None, foreign_key="users.id")
    archived_at: datetime | None = Field(default=None, sa_type=TIMESTAMPTZ)


class Inspection(UUIDPrimaryKey, TenantOwned, table=True):
    """Holds its own copy of the checklist, so later template edits can't rewrite history."""

    __tablename__ = "inspections"
    __table_args__ = (
        UniqueConstraint("organisation_id", "id"),
        ForeignKeyConstraint(
            ["organisation_id", "vehicle_id"], ["vehicles.organisation_id", "vehicles.id"]
        ),
        ForeignKeyConstraint(
            ["organisation_id", "template_id"],
            ["inspection_templates.organisation_id", "inspection_templates.id"],
        ),
        Index("ix_inspections_vehicle_id_performed_at", "vehicle_id", "performed_at"),
        Index("ix_inspections_organisation_id_performed_at", "organisation_id", "performed_at"),
    )

    vehicle_id: uuid.UUID
    template_id: uuid.UUID
    template_name: str = Field(max_length=120)
    performed_at: datetime = Field(sa_type=TIMESTAMPTZ, nullable=False)
    performed_by_user_id: uuid.UUID | None = Field(default=None, foreign_key="users.id")
    odometer_km: Decimal | None = Field(default=None, max_digits=12, decimal_places=1)
    outcome: InspectionOutcome = Field(sa_type=enum_type(InspectionOutcome, "outcome"))
    # [{"label": ..., "critical": bool, "result": "pass|fail|not_applicable", "note": ...}]
    results: list[dict[str, Any]] = Field(default_factory=list, sa_type=JSONB)
    notes: str | None = Field(default=None, max_length=2000)


class Defect(UUIDPrimaryKey, TenantOwned, Timestamps, table=True):
    __tablename__ = "defects"
    __table_args__ = (
        ForeignKeyConstraint(
            ["organisation_id", "vehicle_id"], ["vehicles.organisation_id", "vehicles.id"]
        ),
        ForeignKeyConstraint(
            ["organisation_id", "inspection_id"], ["inspections.organisation_id", "inspections.id"]
        ),
        ForeignKeyConstraint(
            ["organisation_id", "photo_file_id"],
            ["stored_files.organisation_id", "stored_files.id"],
        ),
        ForeignKeyConstraint(
            ["organisation_id", "work_order_id"], ["work_orders.organisation_id", "work_orders.id"]
        ),
        Index("ix_defects_vehicle_id_status", "vehicle_id", "status"),
        Index("ix_defects_organisation_id_status", "organisation_id", "status"),
        Index("ix_defects_work_order_id", "work_order_id"),
    )

    vehicle_id: uuid.UUID
    inspection_id: uuid.UUID | None = Field(default=None)
    title: str = Field(max_length=160)
    description: str | None = Field(default=None, max_length=2000)
    severity: DefectSeverity = Field(sa_type=enum_type(DefectSeverity, "severity"))
    status: DefectStatus = Field(
        default=DefectStatus.OPEN, sa_type=enum_type(DefectStatus, "status")
    )
    photo_file_id: uuid.UUID | None = Field(default=None)
    reported_by_user_id: uuid.UUID | None = Field(default=None, foreign_key="users.id")
    work_order_id: uuid.UUID | None = Field(default=None)
    resolved_at: datetime | None = Field(default=None, sa_type=TIMESTAMPTZ)
    resolved_by_user_id: uuid.UUID | None = Field(default=None, foreign_key="users.id")
    resolution_note: str | None = Field(default=None, max_length=2000)
