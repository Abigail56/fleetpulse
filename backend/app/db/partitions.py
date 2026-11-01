from datetime import date

from sqlalchemy import Connection, text


def ensure_monthly_partitions(connection: Connection, start: date, months: int) -> None:
    """Create the partitions for `months` calendar months from `start`. Safe to re-run."""
    year, month = start.year, start.month
    for _ in range(months):
        connection.execute(
            text("SELECT create_vehicle_locations_partition(:month)"),
            {"month": date(year, month, 1)},
        )
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)


def drop_partitions_before(connection: Connection, cutoff: date) -> list[str]:
    """Apply telemetry retention: drop monthly partitions that end on or before `cutoff`."""
    dropped = connection.execute(
        text("SELECT drop_vehicle_locations_partitions_before(:cutoff)"), {"cutoff": cutoff}
    ).scalars()
    return sorted(dropped)
