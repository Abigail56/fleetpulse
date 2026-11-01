import re
from logging.config import fileConfig
from typing import Any

from alembic import context
from sqlalchemy import create_engine
from sqlmodel import SQLModel

import app.models  # noqa: F401  (registers every table on the metadata)
from app.core.config import get_settings

config = context.config

if config.config_file_name is not None and config.attributes.get("configure_logger", True):
    fileConfig(config.config_file_name, disable_existing_loggers=False)

MONTHLY_PARTITION = re.compile(r"^vehicle_locations_(y\d{4}m\d{2}|default)$")


def include_object(_object: Any, name: str | None, type_: str, _reflected: bool, _to: Any) -> bool:
    """Hide what the models don't declare: PostGIS's own table and telemetry partitions."""
    if type_ == "table" and name is not None:
        return name != "spatial_ref_sys" and MONTHLY_PARTITION.match(name) is None
    return True


def run_migrations() -> None:
    settings = get_settings()
    url = config.attributes.get("database_url") or str(
        settings.migration_database_url or settings.database_url
    )
    # The PostGIS image adds its tiger and topology schemas to the search path. Without this,
    # autogenerate reads their tables as unknown and proposes dropping them.
    engine = create_engine(url, connect_args={"options": "-c search_path=public"})
    with engine.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=SQLModel.metadata,
            include_object=include_object,
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    raise RuntimeError("Offline migrations are not supported; run against a database.")

run_migrations()
