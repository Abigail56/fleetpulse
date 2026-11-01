from sqlalchemy import DateTime, UniqueConstraint
from sqlmodel import SQLModel

import app.models  # noqa: F401

TABLES = SQLModel.metadata.tables


def test_references_to_tenant_tables_include_organisation_id() -> None:
    """A single-column FK to a tenant table would allow cross-tenant links."""
    tenant_tables = {name for name, table in TABLES.items() if "organisation_id" in table.columns}
    offenders = []
    for table in TABLES.values():
        for constraint in table.foreign_key_constraints:
            if constraint.referred_table.name in tenant_tables:
                local_columns = {column.name for column in constraint.columns}
                if "organisation_id" not in local_columns:
                    offenders.append(f"{table.name} -> {constraint.referred_table.name}")
    assert offenders == []


def test_tenant_tables_expose_a_composite_key_for_references() -> None:
    for name in ("vehicles", "drivers", "tracking_devices"):
        unique_sets = [
            {column.name for column in constraint.columns}
            for constraint in TABLES[name].constraints
            if isinstance(constraint, UniqueConstraint)
        ]
        assert {"organisation_id", "id"} in unique_sets, name


def test_every_datetime_column_is_timezone_aware() -> None:
    naive = [
        f"{table.name}.{column.name}"
        for table in TABLES.values()
        for column in table.columns
        if isinstance(column.type, DateTime) and not column.type.timezone
    ]
    assert naive == []


def test_telemetry_history_is_partitioned_by_month_key() -> None:
    table = TABLES["vehicle_locations"]
    assert table.dialect_options["postgresql"]["partition_by"] == "RANGE (recorded_at)"
    assert "recorded_at" in {column.name for column in table.primary_key.columns}
