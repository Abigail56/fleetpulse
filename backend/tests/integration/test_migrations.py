import pytest
from alembic import command
from sqlalchemy import create_engine, inspect

from tests.integration.conftest import alembic_config, scratch_database

pytestmark = pytest.mark.integration


def test_upgrade_downgrade_upgrade_leaves_no_drift() -> None:
    with scratch_database("fleetpulse_test_migrations") as url:
        config = alembic_config(url)
        command.upgrade(config, "head")
        # Raises if the models and the migrated schema disagree.
        command.check(config)

        command.downgrade(config, "base")
        engine = create_engine(url)
        leftovers = set(inspect(engine).get_table_names(schema="public")) - {
            "alembic_version",
            "spatial_ref_sys",
        }
        engine.dispose()
        assert leftovers == set()

        command.upgrade(config, "head")
        command.check(config)
