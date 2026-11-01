"""Gives the restricted role its login, using the credentials in FLEETPULSE_DATABASE_URL.

Run after migrations, as the owner account. The migration creates the role without a password,
because a password must not live in a migration file.
"""

from psycopg import sql
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url

from app.core.config import get_settings

APP_ROLE = "fleetpulse_app"


def provision_app_role(admin_url: str, app_url: str) -> None:
    url = make_url(app_url)
    if url.username != APP_ROLE or not url.password:
        raise ValueError(f"The app database URL must use the {APP_ROLE} role and a password")
    statement = sql.SQL(
        "ALTER ROLE {} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD {}"
    ).format(sql.Identifier(APP_ROLE), sql.Literal(str(url.password)))
    engine = create_engine(admin_url, isolation_level="AUTOCOMMIT")
    try:
        with engine.connect() as connection:
            driver_connection = connection.connection.driver_connection
            assert driver_connection is not None  # noqa: S101  (an open connection has one)
            connection.exec_driver_sql(statement.as_string(driver_connection))
    finally:
        engine.dispose()


if __name__ == "__main__":
    settings = get_settings()
    if settings.migration_database_url is None:
        raise SystemExit("FLEETPULSE_MIGRATION_DATABASE_URL is required")
    provision_app_role(str(settings.migration_database_url), str(settings.database_url))
