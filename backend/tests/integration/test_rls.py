"""Row-level security, tested as the app's restricted role with no help from application code."""

import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import Engine, text
from sqlalchemy.exc import DBAPIError, ProgrammingError
from sqlmodel import Session, SQLModel, select

from app.db.session import set_db_context
from app.models import (
    Organisation,
    OrganisationInvitation,
    OrganisationMembership,
    User,
    Vehicle,
    VehicleLocation,
)
from app.models.enums import FuelType, OrganisationRole, VehicleType

pytestmark = pytest.mark.integration

# Rows with no organisation_id column of their own are covered by their dedicated policies.
RLS_TABLES = {
    name for name, table in SQLModel.metadata.tables.items() if "organisation_id" in table.columns
} | {"organisations"}


def new_vehicle(organisation_id: uuid.UUID) -> Vehicle:
    return Vehicle(
        organisation_id=organisation_id,
        registration_number=uuid.uuid4().hex[:10],
        make="Isuzu",
        model="NPR",
        vehicle_type=VehicleType.TRUCK,
        fuel_type=FuelType.DIESEL,
    )


def new_organisation(owner: Session) -> Organisation:
    organisation = Organisation(
        name="Org", slug=f"org-{uuid.uuid4().hex[:12]}", country_code="GH", default_currency="GHS"
    )
    owner.add(organisation)
    owner.flush()
    return organisation


class World:
    def __init__(self, owner: Session) -> None:
        self.org_a = new_organisation(owner)
        self.org_b = new_organisation(owner)
        self.user = User(
            email=f"{uuid.uuid4().hex}@example.com", password_hash="x", full_name="User"
        )
        owner.add(self.user)
        owner.flush()
        owner.add(
            OrganisationMembership(
                organisation_id=self.org_a.id, user_id=self.user.id, role=OrganisationRole.OWNER
            )
        )
        self.vehicle_a = new_vehicle(self.org_a.id)
        self.vehicle_b = new_vehicle(self.org_b.id)
        owner.add_all([self.vehicle_a, self.vehicle_b])
        owner.add(
            OrganisationInvitation(
                organisation_id=self.org_b.id,
                email="invited@example.com",
                role=OrganisationRole.DRIVER,
                token_hash=uuid.uuid4().hex + uuid.uuid4().hex,
                invited_by_user_id=self.user.id,
                expires_at=datetime.now(UTC) + timedelta(days=1),
            )
        )
        owner.commit()
        for row in (self.org_a, self.org_b, self.user, self.vehicle_a, self.vehicle_b):
            owner.refresh(row)
        self.a_id, self.b_id = self.org_a.id, self.org_b.id
        self.user_id = self.user.id
        self.vehicle_a_id, self.vehicle_b_id = self.vehicle_a.id, self.vehicle_b.id


@pytest.fixture
def world(migrated_engine: Engine) -> World:
    with Session(migrated_engine) as owner:
        return World(owner)


@pytest.fixture
def app_db(app_engine: Engine) -> Iterator[Session]:
    with Session(app_engine) as db:
        yield db


def vehicle_ids(db: Session) -> set[uuid.UUID]:
    return set(db.exec(select(Vehicle.id)).all())


def test_app_role_cannot_bypass_row_level_security(app_db: Session) -> None:
    row = app_db.execute(
        text(
            "SELECT rolsuper, rolbypassrls, rolcreaterole FROM pg_roles "
            "WHERE rolname = current_user"
        )
    ).one()
    assert tuple(row) == (False, False, False)


def test_every_tenant_table_has_row_level_security(migrated_engine: Engine) -> None:
    with migrated_engine.connect() as connection:
        enabled = set(
            connection.execute(
                text("SELECT relname FROM pg_class WHERE relrowsecurity AND relkind IN ('r', 'p')")
            ).scalars()
        )
    assert enabled >= RLS_TABLES


def test_app_role_has_access_to_every_model_table(migrated_engine: Engine) -> None:
    """A new table without grants fails here rather than in production."""
    with migrated_engine.connect() as connection:
        missing = [
            table
            for table in SQLModel.metadata.tables
            if not connection.execute(
                text("SELECT has_table_privilege('fleetpulse_app', :table, 'SELECT')"),
                {"table": table},
            ).scalar_one()
        ]
    assert missing == []


def test_no_context_sees_no_tenant_rows(app_db: Session, world: World) -> None:
    assert vehicle_ids(app_db) == set()
    assert app_db.exec(select(OrganisationInvitation)).all() == []


def test_context_sees_only_its_own_organisation(app_db: Session, world: World) -> None:
    set_db_context(app_db, organisation_id=world.a_id)
    found = vehicle_ids(app_db)
    assert world.vehicle_a_id in found
    assert world.vehicle_b_id not in found


def test_direct_lookup_by_id_cannot_reach_another_tenant(app_db: Session, world: World) -> None:
    set_db_context(app_db, organisation_id=world.a_id)
    assert app_db.get(Vehicle, world.vehicle_b_id) is None


def test_writing_into_another_organisation_is_rejected(app_db: Session, world: World) -> None:
    set_db_context(app_db, organisation_id=world.a_id)
    app_db.add(new_vehicle(world.b_id))
    with pytest.raises(DBAPIError, match="row-level security"):
        app_db.flush()


def test_updating_another_organisations_rows_changes_nothing(
    app_db: Session, world: World, migrated_engine: Engine
) -> None:
    set_db_context(app_db, organisation_id=world.a_id)
    result = app_db.execute(
        text("UPDATE vehicles SET make = 'Tampered' WHERE id = :id"), {"id": world.vehicle_b_id}
    )
    app_db.commit()
    assert result.rowcount == 0  # type: ignore[attr-defined]
    with Session(migrated_engine) as owner:
        vehicle = owner.get(Vehicle, world.vehicle_b_id)
        assert vehicle is not None
        assert vehicle.make == "Isuzu"


def test_moving_a_row_to_another_organisation_is_rejected(app_db: Session, world: World) -> None:
    set_db_context(app_db, organisation_id=world.a_id)
    with pytest.raises(DBAPIError, match="row-level security"):
        app_db.execute(
            text("UPDATE vehicles SET organisation_id = :other WHERE id = :id"),
            {"other": world.b_id, "id": world.vehicle_a_id},
        )


def test_context_survives_commit_within_a_session(app_db: Session, world: World) -> None:
    set_db_context(app_db, organisation_id=world.a_id)
    assert world.vehicle_a_id in vehicle_ids(app_db)
    app_db.commit()
    assert world.vehicle_a_id in vehicle_ids(app_db)


def test_context_does_not_leak_through_the_connection_pool(
    app_engine: Engine, world: World
) -> None:
    with Session(app_engine) as first:
        set_db_context(first, organisation_id=world.a_id)
        assert vehicle_ids(first)
        first.commit()
    with Session(app_engine) as second:
        assert vehicle_ids(second) == set()


def test_user_sees_their_own_memberships_but_nobody_elses(app_db: Session, world: World) -> None:
    set_db_context(app_db, user_id=world.user_id)
    rows = app_db.exec(select(OrganisationMembership)).all()
    assert {row.user_id for row in rows} == {world.user_id}
    organisations = {row.id for row in app_db.exec(select(Organisation)).all()}
    assert world.a_id in organisations
    assert world.b_id not in organisations


def test_user_context_alone_cannot_change_a_membership(app_db: Session, world: World) -> None:
    set_db_context(app_db, user_id=world.user_id)
    result = app_db.execute(text("UPDATE organisation_memberships SET role = 'driver'"))
    assert result.rowcount == 0  # type: ignore[attr-defined]


def test_audit_log_is_read_by_tenant_and_cannot_be_altered(app_db: Session, world: World) -> None:
    set_db_context(app_db, organisation_id=world.a_id)
    for statement in ("UPDATE audit_logs SET action = 'x'", "DELETE FROM audit_logs"):
        with pytest.raises(ProgrammingError, match="permission denied"), app_db.begin_nested():
            app_db.execute(text(statement))


def test_cannot_write_an_audit_row_for_another_organisation(app_db: Session, world: World) -> None:
    set_db_context(app_db, organisation_id=world.a_id)
    with pytest.raises(DBAPIError, match="row-level security"):
        app_db.execute(
            text(
                "INSERT INTO audit_logs (id, organisation_id, action, details, occurred_at) "
                "VALUES (gen_random_uuid(), :org, 'forged', '{}', now())"
            ),
            {"org": world.b_id},
        )


@pytest.mark.parametrize(
    "statement",
    [
        "TRUNCATE vehicles",
        "DROP TABLE vehicles",
        "CREATE TABLE evil (id int)",
        "ALTER TABLE vehicles DISABLE ROW LEVEL SECURITY",
        "SET ROLE fleetpulse",
    ],
)
def test_app_role_cannot_escape_through_ddl(app_db: Session, statement: str) -> None:
    with pytest.raises(DBAPIError), app_db.begin_nested():
        app_db.execute(text(statement))


def test_telemetry_partitions_cannot_be_read_directly(app_db: Session) -> None:
    with pytest.raises(ProgrammingError, match="permission denied"), app_db.begin_nested():
        app_db.execute(text("SELECT * FROM vehicle_locations_default"))


def test_telemetry_is_isolated_through_the_parent_table(
    app_db: Session, migrated_engine: Engine, world: World
) -> None:
    with Session(migrated_engine) as owner:
        owner.add(
            VehicleLocation(
                organisation_id=world.b_id,
                vehicle_id=world.vehicle_b_id,
                recorded_at=datetime.now(UTC),
                location="SRID=4326;POINT(3.38 6.52)",
            )
        )
        owner.commit()
    set_db_context(app_db, organisation_id=world.a_id)
    assert app_db.exec(select(VehicleLocation)).all() == []


def test_invitation_lookup_function_returns_only_the_organisation(
    app_db: Session, world: World, migrated_engine: Engine
) -> None:
    with Session(migrated_engine) as owner:
        token_hash = owner.exec(
            select(OrganisationInvitation.token_hash).where(
                OrganisationInvitation.organisation_id == world.b_id
            )
        ).first()
    found = app_db.execute(
        text("SELECT organisation_id_for_invitation(:hash)"), {"hash": token_hash}
    ).scalar_one()
    assert found == world.b_id
    missing = app_db.execute(
        text("SELECT organisation_id_for_invitation(:hash)"), {"hash": "unknown"}
    ).scalar_one()
    assert missing is None
