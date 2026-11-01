import json
import uuid
from typing import Any

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, func, select

from app.core.errors import ApiError
from app.models import Geofence, GeofenceEvent, GeofenceOccupancy, Vehicle
from app.models.base import utcnow
from app.models.enums import GeofenceKind
from app.services.audit import record_audit

CIRCLE_SEGMENTS = 16
MIN_DISTINCT_POINTS = 3
MAX_AREA_SQUARE_METRES = 1e12


def _not_found() -> ApiError:
    return ApiError(404, "not_found", "Geofence not found.")


def _commit(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        if "uq_geofences_organisation_id_name_active" in str(exc.orig):
            raise ApiError(
                409, "duplicate_name", "A geofence with this name already exists."
            ) from exc
        raise


def _polygon_wkt(boundary: list[tuple[float, float]]) -> str:
    if len(set(boundary)) < MIN_DISTINCT_POINTS:
        raise ApiError(422, "invalid_boundary", "A boundary needs at least 3 different points.")
    longitudes = [point[1] for point in boundary]
    if max(longitudes) - min(longitudes) > 180:
        raise ApiError(422, "invalid_boundary", "This area is too wide to be a geofence.")
    ring = [*boundary, boundary[0]] if boundary[0] != boundary[-1] else boundary
    points = ",".join(f"{longitude} {latitude}" for latitude, longitude in ring)
    return f"POLYGON(({points}))"


def _area_from_input(db: Session, values: dict[str, Any]) -> str:
    """Returns EWKT, after checking the shape with PostGIS."""
    if values["kind"] == GeofenceKind.CIRCLE:
        wkt = db.execute(
            text(
                """
                SELECT ST_AsText(ST_Buffer(
                    ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, :radius, :segments
                )::geometry)
                """
            ),
            {
                "lat": values["center_latitude"],
                "lng": values["center_longitude"],
                "radius": values["radius_m"],
                "segments": CIRCLE_SEGMENTS,
            },
        ).scalar_one()
    else:
        wkt = _polygon_wkt(values["boundary"])
        valid, area = db.execute(
            text(
                """
                SELECT ST_IsValid(ST_GeomFromText(:wkt, 4326)),
                    ST_Area(ST_GeomFromText(:wkt, 4326)::geography)
                """
            ),
            {"wkt": wkt},
        ).one()
        if not valid:
            raise ApiError(422, "invalid_boundary", "The boundary can't cross over itself.")
        if area <= 0 or area > MAX_AREA_SQUARE_METRES:
            raise ApiError(422, "invalid_boundary", "This area is too small or too large.")
    return f"SRID=4326;{wkt}"


def _set_baseline(db: Session, geofence: Geofence) -> None:
    """Vehicles already inside a new or redrawn boundary didn't enter it just now."""
    db.flush()
    db.execute(
        text("DELETE FROM geofence_occupancies WHERE organisation_id = :org AND geofence_id = :id"),
        {"org": geofence.organisation_id, "id": geofence.id},
    )
    db.execute(
        text(
            """
            INSERT INTO geofence_occupancies
                (id, organisation_id, geofence_id, vehicle_id, entered_at)
            SELECT gen_random_uuid(), l.organisation_id, g.id, l.vehicle_id, l.recorded_at
            FROM vehicle_latest_locations l
            JOIN geofences g ON g.id = :id AND g.organisation_id = l.organisation_id
            WHERE l.organisation_id = :org AND ST_Covers(g.area, l.location)
            """
        ),
        {"org": geofence.organisation_id, "id": geofence.id},
    )


def _record(
    db: Session, geofence: Geofence, actor_id: uuid.UUID, action: str, **details: Any
) -> None:
    record_audit(
        db,
        action,
        actor_user_id=actor_id,
        organisation_id=geofence.organisation_id,
        entity_type="geofence",
        entity_id=geofence.id,
        details=details or None,
    )


def create_geofence(
    db: Session, organisation_id: uuid.UUID, actor_id: uuid.UUID, values: dict[str, Any]
) -> Geofence:
    geofence = Geofence(
        organisation_id=organisation_id,
        created_by_user_id=actor_id,
        name=values["name"],
        kind=values["kind"],
        area=_area_from_input(db, values),
        center_latitude=values.get("center_latitude"),
        center_longitude=values.get("center_longitude"),
        radius_m=values.get("radius_m"),
        is_restricted=values["is_restricted"],
        alert_on_entry=values["alert_on_entry"],
        alert_on_exit=values["alert_on_exit"],
    )
    db.add(geofence)
    try:
        _set_baseline(db, geofence)
    except IntegrityError as exc:
        db.rollback()
        if "uq_geofences_organisation_id_name_active" in str(exc.orig):
            raise ApiError(
                409, "duplicate_name", "A geofence with this name already exists."
            ) from exc
        raise
    _record(db, geofence, actor_id, "geofence.created")
    _commit(db)
    return geofence


def get_geofence(db: Session, organisation_id: uuid.UUID, geofence_id: uuid.UUID) -> Geofence:
    geofence = db.exec(
        select(Geofence).where(
            Geofence.id == geofence_id, Geofence.organisation_id == organisation_id
        )
    ).first()
    if geofence is None:
        raise _not_found()
    return geofence


def update_geofence(
    db: Session,
    organisation_id: uuid.UUID,
    geofence_id: uuid.UUID,
    actor_id: uuid.UUID,
    changes: dict[str, Any],
) -> Geofence:
    geofence = get_geofence(db, organisation_id, geofence_id)
    if geofence.archived_at is not None:
        raise ApiError(409, "geofence_archived", "An archived geofence can't be changed.")
    shape_fields = {"kind", "center_latitude", "center_longitude", "radius_m", "boundary"}
    if shape_fields & set(changes):
        kind = changes.get("kind", geofence.kind)
        if kind == GeofenceKind.CIRCLE:
            shape = {
                "kind": kind,
                "center_latitude": changes.get("center_latitude", geofence.center_latitude),
                "center_longitude": changes.get("center_longitude", geofence.center_longitude),
                "radius_m": changes.get("radius_m", geofence.radius_m),
            }
            if None in shape.values():
                raise ApiError(422, "invalid_boundary", "A circle needs a centre and a radius.")
            geofence.center_latitude = shape["center_latitude"]
            geofence.center_longitude = shape["center_longitude"]
            geofence.radius_m = shape["radius_m"]
        else:
            if not changes.get("boundary"):
                raise ApiError(422, "invalid_boundary", "A polygon needs a boundary.")
            shape = {"kind": kind, "boundary": changes["boundary"]}
            geofence.center_latitude = geofence.center_longitude = geofence.radius_m = None
        geofence.kind = kind
        geofence.area = _area_from_input(db, shape)
    for field in ("name", "is_restricted", "alert_on_entry", "alert_on_exit"):
        if field in changes:
            setattr(geofence, field, changes[field])
    geofence.updated_at = utcnow()
    db.add(geofence)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        if "uq_geofences_organisation_id_name_active" in str(exc.orig):
            raise ApiError(
                409, "duplicate_name", "A geofence with this name already exists."
            ) from exc
        raise
    if shape_fields & set(changes):
        _set_baseline(db, geofence)
    _record(db, geofence, actor_id, "geofence.updated", fields=sorted(changes))
    _commit(db)
    return geofence


def archive_geofence(
    db: Session, organisation_id: uuid.UUID, geofence_id: uuid.UUID, actor_id: uuid.UUID
) -> Geofence:
    geofence = get_geofence(db, organisation_id, geofence_id)
    if geofence.archived_at is None:
        geofence.archived_at = utcnow()
        db.add(geofence)
        db.execute(
            GeofenceOccupancy.__table__.delete().where(  # type: ignore[attr-defined]
                GeofenceOccupancy.organisation_id == organisation_id,
                GeofenceOccupancy.geofence_id == geofence_id,
            )
        )
        _record(db, geofence, actor_id, "geofence.archived")
        _commit(db)
    return geofence


def boundaries(db: Session, organisation_id: uuid.UUID) -> dict[uuid.UUID, list[list[float]]]:
    rows = db.execute(
        text(
            "SELECT id, ST_AsGeoJSON(area::geometry, 6) FROM geofences WHERE organisation_id = :org"
        ),
        {"org": organisation_id},
    ).all()
    return {
        row[0]: [[point[1], point[0]] for point in json.loads(row[1])["coordinates"][0]]
        for row in rows
    }


def occupancy_counts(db: Session, organisation_id: uuid.UUID) -> dict[uuid.UUID, int]:
    return dict(
        db.exec(
            select(GeofenceOccupancy.geofence_id, func.count())
            .where(GeofenceOccupancy.organisation_id == organisation_id)
            .group_by(col(GeofenceOccupancy.geofence_id))
        ).all()
    )


def list_geofences(db: Session, organisation_id: uuid.UUID, archived: bool) -> list[Geofence]:
    condition = (
        col(Geofence.archived_at).is_not(None) if archived else col(Geofence.archived_at).is_(None)
    )
    return list(
        db.exec(
            select(Geofence)
            .where(Geofence.organisation_id == organisation_id, condition)
            .order_by(col(Geofence.name))
        ).all()
    )


def list_events(
    db: Session, organisation_id: uuid.UUID, geofence_id: uuid.UUID, page: int, page_size: int
) -> tuple[list[Any], int]:
    get_geofence(db, organisation_id, geofence_id)
    query = (
        select(GeofenceEvent, Vehicle.registration_number)
        .join(
            Vehicle,
            (col(Vehicle.id) == GeofenceEvent.vehicle_id)
            & (col(Vehicle.organisation_id) == GeofenceEvent.organisation_id),
        )
        .where(
            GeofenceEvent.organisation_id == organisation_id,
            GeofenceEvent.geofence_id == geofence_id,
        )
    )
    total = db.exec(select(func.count()).select_from(query.subquery())).one()
    rows = db.exec(
        query.order_by(col(GeofenceEvent.occurred_at).desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return list(rows), total
