import uuid
from datetime import date, timedelta
from typing import Any

from sqlalchemy import select as sa_select
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, func, select

from app.core.errors import ApiError
from app.models import (
    ComplianceDocument,
    Defect,
    Driver,
    Inspection,
    InspectionTemplate,
    StoredFile,
    User,
    Vehicle,
    WorkOrder,
)
from app.models.base import utcnow
from app.models.enums import (
    AlertSeverity,
    AlertType,
    DefectSeverity,
    DefectStatus,
    FilePurpose,
    InspectionOutcome,
    WorkOrderStatus,
    WorkOrderType,
)
from app.services.alerts import (
    DOCUMENT_WARNING_DAYS,
    _alert_values,
    _raise,
    document_state,
    resolve_alert_key,
)
from app.services.audit import record_audit
from app.services.costs import assigned_vehicle

CLOCK_SKEW = timedelta(minutes=5)
DATE_GRACE = timedelta(days=1)
RECENT_DAYS = 30
OPTION_LIMIT = 5000
ALERTING_SEVERITIES = (DefectSeverity.MAJOR, DefectSeverity.CRITICAL)


def _record(
    db: Session,
    organisation_id: uuid.UUID,
    actor_id: uuid.UUID,
    action: str,
    entity_type: str,
    entity_id: uuid.UUID,
    **details: Any,
) -> None:
    # Names only: reference numbers and notes can identify a person.
    record_audit(
        db,
        action,
        actor_user_id=actor_id,
        organisation_id=organisation_id,
        entity_type=entity_type,
        entity_id=entity_id,
        details=details or None,
    )


def _vehicle(db: Session, organisation_id: uuid.UUID, vehicle_id: uuid.UUID) -> Vehicle:
    vehicle = db.exec(
        select(Vehicle).where(
            Vehicle.id == vehicle_id,
            Vehicle.organisation_id == organisation_id,
            col(Vehicle.archived_at).is_(None),
        )
    ).first()
    if vehicle is None:
        raise ApiError(404, "vehicle_not_found", "That vehicle wasn't found.")
    return vehicle


def _usable_vehicle(
    db: Session,
    organisation_id: uuid.UUID,
    vehicle_id: uuid.UUID,
    user_id: uuid.UUID,
    sees_all: bool,
) -> Vehicle:
    vehicle = _vehicle(db, organisation_id, vehicle_id)
    # Drivers inspect and report on the vehicle they're assigned to.
    if not sees_all and assigned_vehicle(db, organisation_id, user_id) != vehicle_id:
        raise ApiError(404, "vehicle_not_found", "That vehicle wasn't found.")
    return vehicle


def _check_file(
    db: Session,
    organisation_id: uuid.UUID,
    file_id: uuid.UUID | None,
    purpose: FilePurpose,
    user_id: uuid.UUID,
    sees_all: bool,
) -> None:
    if file_id is None:
        return
    stored = db.exec(
        select(StoredFile).where(
            StoredFile.id == file_id,
            StoredFile.organisation_id == organisation_id,
            StoredFile.purpose == purpose,
        )
    ).first()
    if stored is None or (not sees_all and stored.uploaded_by_user_id != user_id):
        raise ApiError(404, "file_not_found", "That file wasn't found.")


def driver_for_user(
    db: Session, organisation_id: uuid.UUID, user_id: uuid.UUID
) -> uuid.UUID | None:
    return db.exec(
        select(Driver.id).where(
            Driver.organisation_id == organisation_id, Driver.user_id == user_id
        )
    ).first()


def options(
    db: Session,
    organisation_id: uuid.UUID,
    user_id: uuid.UUID,
    sees_all: bool,
    include_drivers: bool,
) -> tuple[list[Vehicle], list[Driver]]:
    query = (
        select(Vehicle)
        .where(Vehicle.organisation_id == organisation_id, col(Vehicle.archived_at).is_(None))
        .order_by(col(Vehicle.registration_number))
        .limit(OPTION_LIMIT)
    )
    if not sees_all:
        assigned = assigned_vehicle(db, organisation_id, user_id)
        if assigned is None:
            return [], []
        query = query.where(Vehicle.id == assigned)
    drivers: list[Driver] = []
    if include_drivers:
        drivers = list(
            db.exec(
                select(Driver)
                .where(Driver.organisation_id == organisation_id, col(Driver.archived_at).is_(None))
                .order_by(col(Driver.last_name), col(Driver.first_name))
                .limit(OPTION_LIMIT)
            ).all()
        )
    return list(db.exec(query).all()), drivers


# Documents


def _document_rows(organisation_id: uuid.UUID) -> Any:
    return (
        sa_select(
            ComplianceDocument,
            col(Vehicle.registration_number),
            col(Driver.first_name),
            col(Driver.last_name),
            StoredFile,
        )
        .join(
            Vehicle,
            (col(Vehicle.id) == ComplianceDocument.vehicle_id)
            & (col(Vehicle.organisation_id) == ComplianceDocument.organisation_id),
            isouter=True,
        )
        .join(
            Driver,
            (col(Driver.id) == ComplianceDocument.driver_id)
            & (col(Driver.organisation_id) == ComplianceDocument.organisation_id),
            isouter=True,
        )
        .join(
            StoredFile,
            (col(StoredFile.id) == ComplianceDocument.file_id)
            & (col(StoredFile.organisation_id) == ComplianceDocument.organisation_id),
            isouter=True,
        )
        .where(col(ComplianceDocument.organisation_id) == organisation_id)
    )


def list_documents(
    db: Session,
    organisation_id: uuid.UUID,
    today: date,
    *,
    include_driver_documents: bool,
    only_driver_id: uuid.UUID | None,
    vehicle_id: uuid.UUID | None,
    driver_id: uuid.UUID | None,
    state: str | None,
    archived: bool,
) -> list[Any]:
    query = _document_rows(organisation_id).where(
        col(ComplianceDocument.archived_at).is_not(None)
        if archived
        else col(ComplianceDocument.archived_at).is_(None)
    )
    if only_driver_id:
        query = query.where(ComplianceDocument.driver_id == only_driver_id)
    elif not include_driver_documents:
        query = query.where(col(ComplianceDocument.vehicle_id).is_not(None))
    if vehicle_id:
        query = query.where(ComplianceDocument.vehicle_id == vehicle_id)
    if driver_id:
        query = query.where(ComplianceDocument.driver_id == driver_id)
    rows = db.exec(
        query.order_by(
            col(ComplianceDocument.expires_on).nulls_last(), col(ComplianceDocument.title)
        )
    ).all()
    if state:
        rows = [row for row in rows if document_state(row[0].expires_on, today) == state]
    return list(rows)


def get_document_row(
    db: Session,
    organisation_id: uuid.UUID,
    document_id: uuid.UUID,
    *,
    include_driver_documents: bool,
    only_driver_id: uuid.UUID | None = None,
) -> Any:
    row = db.exec(
        _document_rows(organisation_id).where(ComplianceDocument.id == document_id)
    ).first()
    missing = ApiError(404, "not_found", "Document not found.")
    if row is None:
        raise missing
    document = row[0]
    hidden = document.driver_id is not None and not include_driver_documents
    if hidden and (only_driver_id is None or document.driver_id != only_driver_id):
        raise missing
    return row


def _check_file_unattached(
    db: Session,
    organisation_id: uuid.UUID,
    file_id: uuid.UUID | None,
    document_id: uuid.UUID | None,
) -> None:
    """A file has one owner. Attaching a driver's file to a vehicle would make it easier to read."""
    if file_id is None:
        return
    existing = document_for_file(db, organisation_id, file_id)
    if existing is not None and existing.id != document_id:
        raise ApiError(404, "file_not_found", "That file wasn't found.")


def create_document(
    db: Session,
    organisation_id: uuid.UUID,
    actor_id: uuid.UUID,
    can_see_drivers: bool,
    values: dict[str, Any],
) -> ComplianceDocument:
    if values.get("driver_id"):
        if not can_see_drivers:
            raise ApiError(403, "forbidden", "You don't have permission to do that.")
        driver = db.exec(
            select(Driver.id).where(
                Driver.id == values["driver_id"],
                Driver.organisation_id == organisation_id,
                col(Driver.archived_at).is_(None),
            )
        ).first()
        if driver is None:
            raise ApiError(404, "driver_not_found", "That driver wasn't found.")
    else:
        _vehicle(db, organisation_id, values["vehicle_id"])
    _check_dates(values.get("issued_on"), values.get("expires_on"))
    _check_file(db, organisation_id, values.get("file_id"), FilePurpose.DOCUMENT, actor_id, True)
    _check_file_unattached(db, organisation_id, values.get("file_id"), None)
    document = ComplianceDocument(
        organisation_id=organisation_id, created_by_user_id=actor_id, **values
    )
    db.add(document)
    db.flush()
    _record(db, organisation_id, actor_id, "document.created", "document", document.id)
    db.commit()
    return document


def _check_dates(issued_on: date | None, expires_on: date | None) -> None:
    if issued_on and expires_on and expires_on < issued_on:
        raise ApiError(422, "expiry_before_issue", "The expiry date must be after the issue date.")


def update_document(
    db: Session,
    organisation_id: uuid.UUID,
    document_id: uuid.UUID,
    actor_id: uuid.UUID,
    can_see_drivers: bool,
    changes: dict[str, Any],
) -> ComplianceDocument:
    row = get_document_row(
        db, organisation_id, document_id, include_driver_documents=can_see_drivers
    )
    document: ComplianceDocument = row[0]
    if document.archived_at is not None:
        raise ApiError(409, "document_archived", "An archived document can't be changed.")
    for field in ("document_type", "title"):
        if field in changes and changes[field] is None:
            raise ApiError(422, "missing_value", "That value is required.")
    _check_dates(
        changes.get("issued_on", document.issued_on),
        changes.get("expires_on", document.expires_on),
    )
    if changes.get("file_id"):
        _check_file(db, organisation_id, changes["file_id"], FilePurpose.DOCUMENT, actor_id, True)
        _check_file_unattached(db, organisation_id, changes["file_id"], document.id)
    for field, value in changes.items():
        setattr(document, field, value)
    document.updated_at = utcnow()
    db.add(document)
    _record(
        db,
        organisation_id,
        actor_id,
        "document.updated",
        "document",
        document.id,
        fields=sorted(changes),
    )
    db.commit()
    return document


def archive_document(
    db: Session,
    organisation_id: uuid.UUID,
    document_id: uuid.UUID,
    actor_id: uuid.UUID,
    can_see_drivers: bool,
) -> ComplianceDocument:
    document: ComplianceDocument = get_document_row(
        db, organisation_id, document_id, include_driver_documents=can_see_drivers
    )[0]
    if document.archived_at is None:
        document.archived_at = utcnow()
        db.add(document)
        _record(db, organisation_id, actor_id, "document.archived", "document", document.id)
        db.commit()
    return document


def document_for_file(
    db: Session, organisation_id: uuid.UUID, file_id: uuid.UUID
) -> ComplianceDocument | None:
    return db.exec(
        select(ComplianceDocument).where(
            ComplianceDocument.organisation_id == organisation_id,
            ComplianceDocument.file_id == file_id,
        )
    ).first()


# Templates


def _clean_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    labels = [item["label"].casefold() for item in items]
    if len(set(labels)) != len(labels):
        raise ApiError(422, "duplicate_item", "Each checklist item needs a different name.")
    return [
        {
            "id": str(item.get("id") or uuid.uuid4()),
            "label": item["label"],
            "critical": item.get("critical", False),
        }
        for item in items
    ]


def _commit_template(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        if "uq_inspection_templates_organisation_id_name_active" in str(exc.orig):
            raise ApiError(409, "duplicate_name", "A template with this name exists.") from exc
        raise


def list_templates(
    db: Session, organisation_id: uuid.UUID, archived: bool
) -> list[InspectionTemplate]:
    condition = (
        col(InspectionTemplate.archived_at).is_not(None)
        if archived
        else col(InspectionTemplate.archived_at).is_(None)
    )
    return list(
        db.exec(
            select(InspectionTemplate)
            .where(InspectionTemplate.organisation_id == organisation_id, condition)
            .order_by(col(InspectionTemplate.name))
        ).all()
    )


def _template(
    db: Session, organisation_id: uuid.UUID, template_id: uuid.UUID
) -> InspectionTemplate:
    template = db.exec(
        select(InspectionTemplate).where(
            InspectionTemplate.id == template_id,
            InspectionTemplate.organisation_id == organisation_id,
        )
    ).first()
    if template is None:
        raise ApiError(404, "not_found", "Template not found.")
    return template


def get_template(
    db: Session, organisation_id: uuid.UUID, template_id: uuid.UUID
) -> InspectionTemplate:
    return _template(db, organisation_id, template_id)


def create_template(
    db: Session, organisation_id: uuid.UUID, actor_id: uuid.UUID, values: dict[str, Any]
) -> InspectionTemplate:
    template = InspectionTemplate(
        organisation_id=organisation_id,
        created_by_user_id=actor_id,
        name=values["name"],
        items=_clean_items(values["items"]),
    )
    db.add(template)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        if "uq_inspection_templates_organisation_id_name_active" in str(exc.orig):
            raise ApiError(409, "duplicate_name", "A template with this name exists.") from exc
        raise
    _record(db, organisation_id, actor_id, "inspection_template.created", "template", template.id)
    db.commit()
    return template


def update_template(
    db: Session,
    organisation_id: uuid.UUID,
    template_id: uuid.UUID,
    actor_id: uuid.UUID,
    changes: dict[str, Any],
) -> InspectionTemplate:
    template = _template(db, organisation_id, template_id)
    if template.archived_at is not None:
        raise ApiError(409, "template_archived", "An archived template can't be changed.")
    if changes.get("name"):
        template.name = changes["name"]
    if changes.get("items"):
        template.items = _clean_items(changes["items"])
    template.updated_at = utcnow()
    db.add(template)
    _record(db, organisation_id, actor_id, "inspection_template.updated", "template", template.id)
    _commit_template(db)
    return template


def archive_template(
    db: Session, organisation_id: uuid.UUID, template_id: uuid.UUID, actor_id: uuid.UUID
) -> InspectionTemplate:
    template = _template(db, organisation_id, template_id)
    if template.archived_at is None:
        template.archived_at = utcnow()
        db.add(template)
        _record(
            db, organisation_id, actor_id, "inspection_template.archived", "template", template.id
        )
        db.commit()
    return template


# Inspections


def _inspection_rows(organisation_id: uuid.UUID) -> Any:
    return (
        select(Inspection, Vehicle.registration_number, User.full_name)
        .join(
            Vehicle,
            (col(Vehicle.id) == Inspection.vehicle_id)
            & (col(Vehicle.organisation_id) == Inspection.organisation_id),
        )
        .join(User, col(User.id) == Inspection.performed_by_user_id, isouter=True)
        .where(Inspection.organisation_id == organisation_id)
    )


def list_inspections(
    db: Session,
    organisation_id: uuid.UUID,
    *,
    only_user: uuid.UUID | None,
    vehicle_id: uuid.UUID | None,
    outcome: InspectionOutcome | None,
    page: int,
    page_size: int,
) -> tuple[list[Any], int]:
    query = _inspection_rows(organisation_id)
    if only_user:
        query = query.where(Inspection.performed_by_user_id == only_user)
    if vehicle_id:
        query = query.where(Inspection.vehicle_id == vehicle_id)
    if outcome:
        query = query.where(Inspection.outcome == outcome)
    total = db.exec(select(func.count()).select_from(query.subquery())).one()
    rows = db.exec(
        query.order_by(col(Inspection.performed_at).desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return list(rows), total


def get_inspection_row(
    db: Session, organisation_id: uuid.UUID, inspection_id: uuid.UUID, only_user: uuid.UUID | None
) -> Any:
    row = db.exec(_inspection_rows(organisation_id).where(Inspection.id == inspection_id)).first()
    if row is None or (only_user and row[0].performed_by_user_id != only_user):
        raise ApiError(404, "not_found", "Inspection not found.")
    return row


def create_inspection(
    db: Session,
    organisation_id: uuid.UUID,
    actor_id: uuid.UUID,
    sees_all: bool,
    values: dict[str, Any],
) -> Inspection:
    vehicle = _usable_vehicle(db, organisation_id, values["vehicle_id"], actor_id, sees_all)
    template = _template(db, organisation_id, values["template_id"])
    if template.archived_at is not None:
        raise ApiError(409, "template_archived", "That template has been archived.")
    now = utcnow()
    performed_at = values.get("performed_at") or now
    if performed_at > now + CLOCK_SKEW:
        raise ApiError(422, "date_in_future", "The inspection can't be in the future.")
    answers = {str(answer["item_id"]): answer for answer in values["answers"]}
    expected = {item["id"] for item in template.items}
    if set(answers) != expected:
        # A skipped safety item must never look like a pass.
        raise ApiError(422, "incomplete_inspection", "Answer every item on the checklist.")
    results = [
        {
            "label": item["label"],
            "critical": item["critical"],
            "result": answers[item["id"]]["result"],
            "note": answers[item["id"]].get("note"),
        }
        for item in template.items
    ]
    failed = [item for item in results if item["result"] == "fail"]
    inspection = Inspection(
        organisation_id=organisation_id,
        vehicle_id=vehicle.id,
        template_id=template.id,
        template_name=template.name,
        performed_at=performed_at,
        performed_by_user_id=actor_id,
        odometer_km=values.get("odometer_km"),
        outcome=InspectionOutcome.FAILED if failed else InspectionOutcome.PASSED,
        results=results,
        notes=values.get("notes"),
    )
    db.add(inspection)
    db.flush()
    if inspection.odometer_km is not None and inspection.odometer_km > vehicle.odometer_km:
        vehicle.odometer_km = inspection.odometer_km
        vehicle.odometer_recorded_at = now
        db.add(vehicle)
    for item in failed:
        _add_defect(
            db,
            organisation_id,
            actor_id,
            vehicle,
            title=item["label"],
            description=item["note"],
            severity=DefectSeverity.CRITICAL if item["critical"] else DefectSeverity.MINOR,
            inspection_id=inspection.id,
            photo_file_id=None,
        )
    _record(
        db,
        organisation_id,
        actor_id,
        "inspection.completed",
        "inspection",
        inspection.id,
        outcome=inspection.outcome.value,
    )
    db.commit()
    return inspection


# Defects


def _add_defect(
    db: Session,
    organisation_id: uuid.UUID,
    actor_id: uuid.UUID,
    vehicle: Vehicle,
    *,
    title: str,
    description: str | None,
    severity: DefectSeverity,
    inspection_id: uuid.UUID | None,
    photo_file_id: uuid.UUID | None,
) -> Defect:
    defect = Defect(
        organisation_id=organisation_id,
        vehicle_id=vehicle.id,
        inspection_id=inspection_id,
        title=title,
        description=description,
        severity=severity,
        photo_file_id=photo_file_id,
        reported_by_user_id=actor_id,
    )
    db.add(defect)
    db.flush()
    if severity in ALERTING_SEVERITIES:
        critical = severity == DefectSeverity.CRITICAL
        _raise(
            db,
            [
                _alert_values(
                    organisation_id,
                    AlertType.DEFECT_REPORTED,
                    AlertSeverity.CRITICAL if critical else AlertSeverity.WARNING,
                    f"{vehicle.registration_number}: {title}",
                    (
                        "A critical defect was reported. This vehicle can't be dispatched "
                        "until it's resolved."
                    )
                    if critical
                    else "A major defect was reported.",
                    utcnow(),
                    vehicle_id=vehicle.id,
                    dedupe_key=f"defect:{defect.id}",
                )
            ],
        )
    return defect


def _defect_rows(organisation_id: uuid.UUID) -> Any:
    return (
        select(Defect, Vehicle.registration_number, StoredFile)
        .join(
            Vehicle,
            (col(Vehicle.id) == Defect.vehicle_id)
            & (col(Vehicle.organisation_id) == Defect.organisation_id),
        )
        .join(
            StoredFile,
            (col(StoredFile.id) == Defect.photo_file_id)
            & (col(StoredFile.organisation_id) == Defect.organisation_id),
            isouter=True,
        )
        .where(Defect.organisation_id == organisation_id)
    )


def list_defects(
    db: Session,
    organisation_id: uuid.UUID,
    *,
    only_user: uuid.UUID | None,
    status: DefectStatus | None,
    severity: DefectSeverity | None,
    vehicle_id: uuid.UUID | None,
    page: int,
    page_size: int,
) -> tuple[list[Any], int]:
    query = _defect_rows(organisation_id)
    if only_user:
        query = query.where(Defect.reported_by_user_id == only_user)
    if status:
        query = query.where(Defect.status == status)
    if severity:
        query = query.where(Defect.severity == severity)
    if vehicle_id:
        query = query.where(Defect.vehicle_id == vehicle_id)
    total = db.exec(select(func.count()).select_from(query.subquery())).one()
    rows = db.exec(
        query.order_by(col(Defect.status), col(Defect.created_at).desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return list(rows), total


def get_defect_row(
    db: Session, organisation_id: uuid.UUID, defect_id: uuid.UUID, only_user: uuid.UUID | None
) -> Any:
    row = db.exec(_defect_rows(organisation_id).where(Defect.id == defect_id)).first()
    if row is None or (only_user and row[0].reported_by_user_id != only_user):
        raise ApiError(404, "not_found", "Defect not found.")
    return row


def create_defect(
    db: Session,
    organisation_id: uuid.UUID,
    actor_id: uuid.UUID,
    sees_all: bool,
    values: dict[str, Any],
) -> Defect:
    vehicle = _usable_vehicle(db, organisation_id, values["vehicle_id"], actor_id, sees_all)
    _check_file(
        db,
        organisation_id,
        values.get("photo_file_id"),
        FilePurpose.INSPECTION,
        actor_id,
        sees_all,
    )
    defect = _add_defect(
        db,
        organisation_id,
        actor_id,
        vehicle,
        title=values["title"],
        description=values.get("description"),
        severity=values["severity"],
        inspection_id=None,
        photo_file_id=values.get("photo_file_id"),
    )
    _record(db, organisation_id, actor_id, "defect.reported", "defect", defect.id)
    db.commit()
    return defect


def _locked_defect(db: Session, organisation_id: uuid.UUID, defect_id: uuid.UUID) -> Defect:
    defect = db.exec(
        select(Defect)
        .where(Defect.id == defect_id, Defect.organisation_id == organisation_id)
        .with_for_update()
    ).first()
    if defect is None:
        raise ApiError(404, "not_found", "Defect not found.")
    return defect


def resolve_defect(
    db: Session,
    organisation_id: uuid.UUID,
    defect_id: uuid.UUID,
    actor_id: uuid.UUID,
    note: str | None,
) -> Defect:
    defect = _locked_defect(db, organisation_id, defect_id)
    if defect.status == DefectStatus.RESOLVED:
        raise ApiError(409, "already_resolved", "This defect has already been resolved.")
    mark_resolved(db, defect, actor_id, note)
    _record(db, organisation_id, actor_id, "defect.resolved", "defect", defect.id)
    db.commit()
    return defect


def mark_resolved(db: Session, defect: Defect, actor_id: uuid.UUID, note: str | None) -> None:
    defect.status = DefectStatus.RESOLVED
    defect.resolved_at = utcnow()
    defect.resolved_by_user_id = actor_id
    defect.resolution_note = note
    defect.updated_at = utcnow()
    db.add(defect)
    resolve_alert_key(db, defect.organisation_id, f"defect:{defect.id}")


def create_work_order(
    db: Session,
    organisation_id: uuid.UUID,
    defect_id: uuid.UUID,
    actor_id: uuid.UUID,
    currency: str,
) -> WorkOrder:
    defect = _locked_defect(db, organisation_id, defect_id)
    if defect.status == DefectStatus.RESOLVED:
        raise ApiError(409, "already_resolved", "This defect has already been resolved.")
    if defect.work_order_id is not None:
        existing = db.get(WorkOrder, defect.work_order_id)
        if existing is not None and existing.status in (
            WorkOrderStatus.OPEN,
            WorkOrderStatus.IN_PROGRESS,
        ):
            raise ApiError(409, "work_order_exists", "This defect already has a work order.")
    order = WorkOrder(
        organisation_id=organisation_id,
        vehicle_id=defect.vehicle_id,
        work_type=WorkOrderType.CORRECTIVE,
        title=f"Fix: {defect.title}"[:160],
        description=defect.description,
        currency=currency,
        created_by_user_id=actor_id,
    )
    db.add(order)
    db.flush()
    defect.work_order_id = order.id
    defect.updated_at = utcnow()
    db.add(defect)
    _record(db, organisation_id, actor_id, "work_order.created", "work_order", order.id)
    db.commit()
    return order


def summary(db: Session, organisation_id: uuid.UUID, today: date) -> tuple[int, int, int, int, int]:
    documents = db.exec(
        select(col(ComplianceDocument.expires_on)).where(
            ComplianceDocument.organisation_id == organisation_id,
            col(ComplianceDocument.archived_at).is_(None),
            col(ComplianceDocument.expires_on).is_not(None),
            col(ComplianceDocument.expires_on) <= today + timedelta(days=DOCUMENT_WARNING_DAYS),
        )
    ).all()
    expired = sum(1 for expires_on in documents if expires_on and expires_on < today)
    counts = dict(
        db.exec(
            select(Defect.severity, func.count())
            .where(Defect.organisation_id == organisation_id, Defect.status == DefectStatus.OPEN)
            .group_by(col(Defect.severity))
        ).all()
    )
    failed = db.exec(
        select(func.count()).where(
            Inspection.organisation_id == organisation_id,
            Inspection.outcome == InspectionOutcome.FAILED,
            col(Inspection.performed_at) >= utcnow() - timedelta(days=RECENT_DAYS),
        )
    ).one()
    return (
        expired,
        len(documents) - expired,
        sum(counts.values()),
        counts.get(DefectSeverity.CRITICAL, 0),
        failed,
    )
