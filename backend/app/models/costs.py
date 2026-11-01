import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import CheckConstraint, ForeignKeyConstraint, Index, UniqueConstraint
from sqlmodel import Field

from app.models.base import TIMESTAMPTZ, TenantOwned, Timestamps, UUIDPrimaryKey, enum_type, utcnow
from app.models.enums import ExpenseCategory, ExpenseStatus, FilePurpose, FuelUnit


class StoredFile(UUIDPrimaryKey, TenantOwned, table=True):
    """A file in private object storage. Its contents never pass through a public address."""

    __tablename__ = "stored_files"
    __table_args__ = (
        UniqueConstraint("organisation_id", "id"),
        CheckConstraint("size_bytes > 0", name="size_positive"),
    )

    object_key: str = Field(max_length=255, unique=True)
    filename: str = Field(max_length=255)
    content_type: str = Field(max_length=100)
    size_bytes: int
    purpose: FilePurpose = Field(sa_type=enum_type(FilePurpose, "purpose"))
    uploaded_by_user_id: uuid.UUID | None = Field(default=None, foreign_key="users.id")
    created_at: datetime = Field(default_factory=utcnow, sa_type=TIMESTAMPTZ, nullable=False)


class FuelTransaction(UUIDPrimaryKey, TenantOwned, Timestamps, table=True):
    __tablename__ = "fuel_transactions"
    __table_args__ = (
        ForeignKeyConstraint(
            ["organisation_id", "vehicle_id"], ["vehicles.organisation_id", "vehicles.id"]
        ),
        ForeignKeyConstraint(
            ["organisation_id", "receipt_file_id"],
            ["stored_files.organisation_id", "stored_files.id"],
        ),
        Index("ix_fuel_transactions_vehicle_id_filled_at", "vehicle_id", "filled_at"),
        Index("ix_fuel_transactions_organisation_id_filled_at", "organisation_id", "filled_at"),
        CheckConstraint("quantity > 0", name="quantity_positive"),
        CheckConstraint("unit_price >= 0", name="unit_price_not_negative"),
        CheckConstraint("total_cost >= 0", name="total_cost_not_negative"),
        CheckConstraint("currency ~ '^[A-Z]{3}$'", name="currency_iso4217"),
    )

    vehicle_id: uuid.UUID
    filled_at: datetime = Field(sa_type=TIMESTAMPTZ, nullable=False)
    quantity: Decimal = Field(max_digits=10, decimal_places=3)
    unit: FuelUnit = Field(default=FuelUnit.LITRES, sa_type=enum_type(FuelUnit, "unit"))
    unit_price: Decimal = Field(max_digits=12, decimal_places=4)
    total_cost: Decimal = Field(max_digits=14, decimal_places=2)
    currency: str = Field(max_length=3)
    odometer_km: Decimal | None = Field(default=None, max_digits=12, decimal_places=1)
    # Consumption can only be measured between two fills that both reached full.
    is_full_tank: bool = Field(default=False)
    station_name: str | None = Field(default=None, max_length=160)
    notes: str | None = Field(default=None, max_length=2000)
    receipt_file_id: uuid.UUID | None = Field(default=None)
    created_by_user_id: uuid.UUID | None = Field(default=None, foreign_key="users.id")
    voided_at: datetime | None = Field(default=None, sa_type=TIMESTAMPTZ)


class Expense(UUIDPrimaryKey, TenantOwned, Timestamps, table=True):
    __tablename__ = "expenses"
    __table_args__ = (
        ForeignKeyConstraint(
            ["organisation_id", "vehicle_id"], ["vehicles.organisation_id", "vehicles.id"]
        ),
        ForeignKeyConstraint(
            ["organisation_id", "receipt_file_id"],
            ["stored_files.organisation_id", "stored_files.id"],
        ),
        Index("ix_expenses_vehicle_id_incurred_on", "vehicle_id", "incurred_on"),
        Index("ix_expenses_organisation_id_status", "organisation_id", "status"),
        CheckConstraint("amount > 0", name="amount_positive"),
        CheckConstraint("currency ~ '^[A-Z]{3}$'", name="currency_iso4217"),
    )

    vehicle_id: uuid.UUID
    category: ExpenseCategory = Field(sa_type=enum_type(ExpenseCategory, "category"))
    amount: Decimal = Field(max_digits=14, decimal_places=2)
    currency: str = Field(max_length=3)
    incurred_on: date
    vendor: str | None = Field(default=None, max_length=160)
    description: str | None = Field(default=None, max_length=2000)
    receipt_file_id: uuid.UUID | None = Field(default=None)
    status: ExpenseStatus = Field(
        default=ExpenseStatus.SUBMITTED, sa_type=enum_type(ExpenseStatus, "status")
    )
    submitted_by_user_id: uuid.UUID | None = Field(default=None, foreign_key="users.id")
    reviewed_by_user_id: uuid.UUID | None = Field(default=None, foreign_key="users.id")
    reviewed_at: datetime | None = Field(default=None, sa_type=TIMESTAMPTZ)
    review_note: str | None = Field(default=None, max_length=1000)
    voided_at: datetime | None = Field(default=None, sa_type=TIMESTAMPTZ)
