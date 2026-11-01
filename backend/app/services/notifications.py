import smtplib
import uuid
from collections.abc import Callable
from datetime import datetime, timedelta
from typing import Any

import structlog
from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlmodel import Session, col, func, select, update

from app.core.config import Settings
from app.core.errors import ApiError
from app.core.permissions import Permission, role_has_permission
from app.db.session import set_db_context
from app.models import (
    Alert,
    AutomationRule,
    AutomationRun,
    Notification,
    NotificationPreference,
    Organisation,
    OrganisationMembership,
    User,
    Vehicle,
    WorkOrder,
)
from app.models.base import utcnow
from app.models.enums import (
    AlertSeverity,
    AlertType,
    AutomationRunStatus,
    EmailMode,
    MembershipStatus,
    NotificationEmailStatus,
    OrganisationRole,
    WorkOrderType,
)
from app.services.audit import record_audit

ALERT_BATCH = 500
EMAIL_BATCH = 100
MAX_EMAIL_ATTEMPTS = 5
MAX_RUN_ATTEMPTS = 3
RETRY_BASE = timedelta(minutes=1)
SEVERITY_ORDER = {AlertSeverity.INFO: 0, AlertSeverity.WARNING: 1, AlertSeverity.CRITICAL: 2}
SMTP_FAILURES = (smtplib.SMTPException, OSError)

logger = structlog.get_logger(__name__)

EmailSender = Callable[[str, str, str], None]


def _retry_at(attempts: int) -> datetime:
    return utcnow() + RETRY_BASE * int(2**attempts)


# People


def _recipients(
    db: Session, organisation_id: uuid.UUID
) -> list[tuple[uuid.UUID, OrganisationRole]]:
    """Checked each time, so removed or suspended people stop being told at once."""
    rows = db.exec(
        select(User.id, OrganisationMembership.role)
        .join(OrganisationMembership, col(OrganisationMembership.user_id) == User.id)
        .where(
            OrganisationMembership.organisation_id == organisation_id,
            OrganisationMembership.status == MembershipStatus.ACTIVE,
            col(User.is_active).is_(True),
            col(User.email_verified_at).is_not(None),
        )
    ).all()
    return [
        (user_id, OrganisationRole(role))
        for user_id, role in rows
        if role_has_permission(OrganisationRole(role), Permission.ALERTS_VIEW)
    ]


def _wants_email(mode: EmailMode, severity: AlertSeverity) -> bool:
    return mode == EmailMode.ALL or (
        mode == EmailMode.CRITICAL and severity == AlertSeverity.CRITICAL
    )


# Rules


def _matching_rules(rules: list[AutomationRule], alert: Alert) -> list[AutomationRule]:
    matched = []
    for rule in rules:
        if alert.alert_type.value not in rule.alert_types:
            continue
        if SEVERITY_ORDER[alert.severity] < SEVERITY_ORDER[rule.min_severity]:
            continue
        if rule.vehicle_id is not None and rule.vehicle_id != alert.vehicle_id:
            continue
        matched.append(rule)
    return matched


def _fan_out(
    db: Session,
    alert: Alert,
    recipients: list[tuple[uuid.UUID, OrganisationRole]],
    preferences: dict[tuple[uuid.UUID, AlertType], NotificationPreference],
) -> None:
    rows = []
    now = utcnow()
    for user_id, _role in recipients:
        preference = preferences.get((user_id, alert.alert_type))
        in_app = preference.in_app if preference else True
        mode = preference.email_mode if preference else EmailMode.CRITICAL
        email = _wants_email(mode, alert.severity)
        if not in_app and not email:
            continue
        rows.append(
            {
                "id": uuid.uuid4(),
                "organisation_id": alert.organisation_id,
                "user_id": user_id,
                "alert_id": alert.id,
                "title": alert.title,
                "body": alert.message,
                "severity": alert.severity,
                "show_in_app": in_app,
                "email_status": (
                    NotificationEmailStatus.PENDING
                    if email
                    else NotificationEmailStatus.NOT_REQUESTED
                ),
                "next_email_at": now if email else None,
                "email_attempts": 0,
                "created_at": now,
            }
        )
    if rows:
        db.execute(insert(Notification).on_conflict_do_nothing(), rows)


def _run_notify(db: Session, alert: Alert, action: dict[str, Any]) -> str:
    roles = set(action["roles"])
    now = utcnow()
    wanted = [
        user_id for user_id, role in _recipients(db, alert.organisation_id) if role.value in roles
    ]
    for user_id in wanted:
        statement = insert(Notification).values(
            id=uuid.uuid4(),
            organisation_id=alert.organisation_id,
            user_id=user_id,
            alert_id=alert.id,
            title=alert.title,
            body=alert.message,
            severity=alert.severity,
            show_in_app=True,
            email_status=(
                NotificationEmailStatus.PENDING
                if action.get("email")
                else NotificationEmailStatus.NOT_REQUESTED
            ),
            next_email_at=now if action.get("email") else None,
            email_attempts=0,
            created_at=now,
        )
        # Someone already notified still gets the email the rule asks for, once.
        changes: dict[str, Any] = {"show_in_app": True}
        if action.get("email"):
            db.execute(
                statement.on_conflict_do_update(
                    index_elements=["user_id", "alert_id"],
                    set_={
                        **changes,
                        "email_status": NotificationEmailStatus.PENDING,
                        "next_email_at": now,
                    },
                    where=col(Notification.email_status) == NotificationEmailStatus.NOT_REQUESTED,
                )
            )
            db.execute(
                update(Notification)
                .where(
                    col(Notification.user_id) == user_id,
                    col(Notification.alert_id) == alert.id,
                )
                .values(show_in_app=True)
            )
        else:
            db.execute(
                statement.on_conflict_do_update(
                    index_elements=["user_id", "alert_id"], set_=changes
                )
            )
    return f"Notified {len(wanted)} {'person' if len(wanted) == 1 else 'people'}"


def _run_work_order(
    db: Session, alert: Alert, rule: AutomationRule, action: dict[str, Any]
) -> str | None:
    if alert.vehicle_id is None:
        return None
    vehicle = db.exec(
        select(Vehicle).where(
            Vehicle.id == alert.vehicle_id,
            Vehicle.organisation_id == alert.organisation_id,
            col(Vehicle.archived_at).is_(None),
        )
    ).first()
    if vehicle is None:
        return None
    organisation = db.get(Organisation, alert.organisation_id)
    assert organisation is not None  # noqa: S101
    order = WorkOrder(
        organisation_id=alert.organisation_id,
        vehicle_id=vehicle.id,
        work_type=(
            WorkOrderType.PREVENTIVE
            if alert.alert_type == AlertType.MAINTENANCE_DUE
            else WorkOrderType.CORRECTIVE
        ),
        title=(action.get("title") or alert.title)[:160],
        description=f"Created automatically by the rule “{rule.name}”. {alert.message}"[:4000],
        currency=organisation.default_currency,
    )
    db.add(order)
    db.flush()
    record_audit(
        db,
        "work_order.created",
        organisation_id=alert.organisation_id,
        entity_type="work_order",
        entity_id=order.id,
        details={"automation_rule_id": str(rule.id)},
    )
    return "Created a work order"


def _execute_run(db: Session, run: AutomationRun, rule: AutomationRule, alert: Alert) -> None:
    run.attempts += 1
    outcomes: list[str] = []
    skipped = False
    try:
        # All of a rule's actions happen, or none do, so a retry can't repeat half of them.
        with db.begin_nested():
            for action in rule.actions:
                if action["type"] == "notify":
                    outcomes.append(_run_notify(db, alert, action))
                elif action["type"] == "create_work_order":
                    result = _run_work_order(db, alert, rule, action)
                    if result is None:
                        skipped = True
                        outcomes.append("No active vehicle, so no work order was created")
                    else:
                        outcomes.append(result)
    except SQLAlchemyError as exc:
        logger.warning("automation_run_failed", run_id=str(run.id), error=type(exc).__name__)
        if run.attempts >= MAX_RUN_ATTEMPTS:
            run.status = AutomationRunStatus.FAILED
            run.outcome = f"Failed after {run.attempts} attempts"
            run.next_attempt_at = None
            run.finished_at = utcnow()
        else:
            run.outcome = f"Attempt {run.attempts} failed. Will retry"
            run.next_attempt_at = _retry_at(run.attempts)
        db.add(run)
        return
    run.status = (
        AutomationRunStatus.SKIPPED
        if skipped and len(outcomes) == 1
        else AutomationRunStatus.SUCCEEDED
    )
    run.outcome = ". ".join(outcomes)[:255]
    run.next_attempt_at = None
    run.finished_at = utcnow()
    db.add(run)


def _process_alerts(db: Session, organisation_id: uuid.UUID) -> int:
    alerts = db.exec(
        select(Alert)
        .where(Alert.organisation_id == organisation_id, col(Alert.notified_at).is_(None))
        .order_by(col(Alert.created_at))
        .limit(ALERT_BATCH)
        # Two workers can't take the same alert.
        .with_for_update(skip_locked=True)
    ).all()
    if not alerts:
        return 0
    recipients = _recipients(db, organisation_id)
    preferences = {
        (item.user_id, item.alert_type): item
        for item in db.exec(
            select(NotificationPreference).where(
                NotificationPreference.organisation_id == organisation_id
            )
        ).all()
    }
    rules = list(
        db.exec(
            select(AutomationRule).where(
                AutomationRule.organisation_id == organisation_id,
                col(AutomationRule.is_enabled).is_(True),
                col(AutomationRule.archived_at).is_(None),
            )
        ).all()
    )
    now = utcnow()
    for alert in alerts:
        # Already over by the time it was picked up: no need to disturb anyone.
        if alert.resolved_at is None:
            _fan_out(db, alert, recipients, preferences)
            for rule in _matching_rules(rules, alert):
                db.execute(
                    insert(AutomationRun)
                    .values(
                        id=uuid.uuid4(),
                        organisation_id=organisation_id,
                        rule_id=rule.id,
                        alert_id=alert.id,
                        status=AutomationRunStatus.PENDING,
                        attempts=0,
                        next_attempt_at=now,
                        created_at=now,
                    )
                    .on_conflict_do_nothing()
                )
        alert.notified_at = now
        db.add(alert)
    db.commit()
    return len(alerts)


def _process_runs(db: Session, organisation_id: uuid.UUID) -> None:
    runs = db.exec(
        select(AutomationRun)
        .where(
            AutomationRun.organisation_id == organisation_id,
            AutomationRun.status == AutomationRunStatus.PENDING,
            col(AutomationRun.next_attempt_at) <= utcnow(),
        )
        .order_by(col(AutomationRun.created_at))
        .limit(ALERT_BATCH)
        .with_for_update(skip_locked=True)
    ).all()
    for run in runs:
        rule = db.get(AutomationRule, run.rule_id)
        alert = db.get(Alert, run.alert_id)
        if rule is None or alert is None:
            continue
        # Turned off since this was queued, so it doesn't go ahead.
        if not rule.is_enabled or rule.archived_at is not None:
            run.status = AutomationRunStatus.SKIPPED
            run.outcome = "The rule was turned off before this ran"
            run.next_attempt_at = None
            run.finished_at = utcnow()
            db.add(run)
        else:
            _execute_run(db, run, rule, alert)
        db.commit()


def _clean_header(value: str) -> str:
    return " ".join(value.split())


def _process_emails(
    db: Session, settings: Settings, organisation_id: uuid.UUID, send: EmailSender
) -> None:
    rows = db.exec(
        select(Notification, User.email)
        .join(User, col(User.id) == Notification.user_id)
        .where(
            Notification.organisation_id == organisation_id,
            Notification.email_status == NotificationEmailStatus.PENDING,
            col(Notification.next_email_at) <= utcnow(),
            col(User.is_active).is_(True),
        )
        .order_by(col(Notification.created_at))
        .limit(EMAIL_BATCH)
        .with_for_update(of=Notification, skip_locked=True)
    ).all()
    link = f"{settings.frontend_base_url.rstrip('/')}/alerts"
    for notification, address in rows:
        notification.email_attempts += 1
        try:
            send(
                address,
                _clean_header(f"FleetPulse alert: {notification.title}"),
                f"{notification.body}\n\nSee it in FleetPulse: {link}\n\n"
                "You can change which alerts you're emailed about under Notifications.",
            )
        except SMTP_FAILURES as exc:
            logger.warning(
                "notification_email_failed",
                notification_id=str(notification.id),
                error=type(exc).__name__,
            )
            if notification.email_attempts >= MAX_EMAIL_ATTEMPTS:
                notification.email_status = NotificationEmailStatus.FAILED
                notification.next_email_at = None
            else:
                notification.next_email_at = _retry_at(notification.email_attempts)
        else:
            notification.email_status = NotificationEmailStatus.SENT
            notification.next_email_at = None
        db.add(notification)
        # After each one, so a crash can't send the earlier ones a second time.
        db.commit()


def dispatch(db: Session, settings: Settings, send: EmailSender) -> None:
    organisations = db.execute(text("SELECT * FROM alert_sweep_organisations()")).all()
    for organisation_id, _timezone in organisations:
        try:
            set_db_context(db, organisation_id=organisation_id)
            _process_alerts(db, organisation_id)
            _process_runs(db, organisation_id)
            _process_emails(db, settings, organisation_id, send)
        except SQLAlchemyError as exc:
            # One organisation's problem shouldn't hold up the others.
            db.rollback()
            logger.error(
                "notification_dispatch_failed",
                organisation_id=str(organisation_id),
                error=type(exc).__name__,
            )


# Reading


def list_notifications(
    db: Session,
    organisation_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    unread_only: bool,
    page: int,
    page_size: int,
) -> tuple[list[Notification], int]:
    query = select(Notification).where(
        Notification.organisation_id == organisation_id,
        Notification.user_id == user_id,
        col(Notification.show_in_app).is_(True),
    )
    if unread_only:
        query = query.where(col(Notification.read_at).is_(None))
    total = db.exec(select(func.count()).select_from(query.subquery())).one()
    rows = db.exec(
        query.order_by(col(Notification.created_at).desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return list(rows), total


def unread_count(db: Session, organisation_id: uuid.UUID, user_id: uuid.UUID) -> int:
    return db.exec(
        select(func.count()).where(
            Notification.organisation_id == organisation_id,
            Notification.user_id == user_id,
            col(Notification.show_in_app).is_(True),
            col(Notification.read_at).is_(None),
        )
    ).one()


def mark_read(
    db: Session, organisation_id: uuid.UUID, user_id: uuid.UUID, notification_id: uuid.UUID
) -> Notification:
    notification = db.exec(
        select(Notification).where(
            Notification.id == notification_id,
            Notification.organisation_id == organisation_id,
            Notification.user_id == user_id,
        )
    ).first()
    if notification is None:
        raise ApiError(404, "not_found", "Notification not found.")
    if notification.read_at is None:
        notification.read_at = utcnow()
        db.add(notification)
        db.commit()
    return notification


def mark_all_read(db: Session, organisation_id: uuid.UUID, user_id: uuid.UUID) -> None:
    db.execute(
        update(Notification)
        .where(
            col(Notification.organisation_id) == organisation_id,
            col(Notification.user_id) == user_id,
            col(Notification.read_at).is_(None),
        )
        .values(read_at=utcnow())
    )
    db.commit()


def preferences(
    db: Session, organisation_id: uuid.UUID, user_id: uuid.UUID
) -> list[tuple[AlertType, bool, EmailMode]]:
    saved = {
        item.alert_type: item
        for item in db.exec(
            select(NotificationPreference).where(
                NotificationPreference.organisation_id == organisation_id,
                NotificationPreference.user_id == user_id,
            )
        ).all()
    }
    return [
        (kind, saved[kind].in_app, saved[kind].email_mode)
        if kind in saved
        else (kind, True, EmailMode.CRITICAL)
        for kind in AlertType
    ]


def save_preferences(
    db: Session, organisation_id: uuid.UUID, user_id: uuid.UUID, items: list[dict[str, Any]]
) -> None:
    now = utcnow()
    for item in items:
        db.execute(
            insert(NotificationPreference)
            .values(
                id=uuid.uuid4(),
                organisation_id=organisation_id,
                user_id=user_id,
                alert_type=item["alert_type"],
                in_app=item["in_app"],
                email_mode=item["email_mode"],
                created_at=now,
                updated_at=now,
            )
            .on_conflict_do_update(
                index_elements=["organisation_id", "user_id", "alert_type"],
                set_={
                    "in_app": item["in_app"],
                    "email_mode": item["email_mode"],
                    "updated_at": now,
                },
            )
        )
    db.commit()


# Rule management


def _check_rule_vehicle(
    db: Session, organisation_id: uuid.UUID, vehicle_id: uuid.UUID | None
) -> None:
    if vehicle_id is None:
        return
    found = db.exec(
        select(Vehicle.id).where(
            Vehicle.id == vehicle_id,
            Vehicle.organisation_id == organisation_id,
            col(Vehicle.archived_at).is_(None),
        )
    ).first()
    if found is None:
        raise ApiError(404, "vehicle_not_found", "That vehicle wasn't found.")


def _check_action_roles(actions: list[dict[str, Any]]) -> None:
    # Alerts can name vehicles and people, so rules can't send them past the alerts permission.
    for action in actions:
        if action["type"] != "notify":
            continue
        for role in action["roles"]:
            if not role_has_permission(OrganisationRole(role), Permission.ALERTS_VIEW):
                raise ApiError(
                    422, "role_cannot_view_alerts", "One of those roles can't view alerts."
                )


def _rule_commit(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        if "uq_automation_rules_organisation_id_name_active" in str(exc.orig):
            raise ApiError(409, "duplicate_name", "A rule with this name already exists.") from exc
        raise


def list_rules(db: Session, organisation_id: uuid.UUID, archived: bool) -> list[AutomationRule]:
    condition = (
        col(AutomationRule.archived_at).is_not(None)
        if archived
        else col(AutomationRule.archived_at).is_(None)
    )
    return list(
        db.exec(
            select(AutomationRule)
            .where(AutomationRule.organisation_id == organisation_id, condition)
            .order_by(col(AutomationRule.name))
        ).all()
    )


def get_rule(db: Session, organisation_id: uuid.UUID, rule_id: uuid.UUID) -> AutomationRule:
    rule = db.exec(
        select(AutomationRule).where(
            AutomationRule.id == rule_id, AutomationRule.organisation_id == organisation_id
        )
    ).first()
    if rule is None:
        raise ApiError(404, "not_found", "Rule not found.")
    return rule


def create_rule(
    db: Session, organisation_id: uuid.UUID, actor_id: uuid.UUID, values: dict[str, Any]
) -> AutomationRule:
    _check_rule_vehicle(db, organisation_id, values.get("vehicle_id"))
    _check_action_roles(values["actions"])
    rule = AutomationRule(
        organisation_id=organisation_id,
        created_by_user_id=actor_id,
        **{**values, "alert_types": [item.value for item in values["alert_types"]]},
    )
    db.add(rule)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        if "uq_automation_rules_organisation_id_name_active" in str(exc.orig):
            raise ApiError(409, "duplicate_name", "A rule with this name already exists.") from exc
        raise
    record_audit(
        db,
        "automation_rule.created",
        actor_user_id=actor_id,
        organisation_id=organisation_id,
        entity_type="automation_rule",
        entity_id=rule.id,
    )
    db.commit()
    return rule


def update_rule(
    db: Session,
    organisation_id: uuid.UUID,
    rule_id: uuid.UUID,
    actor_id: uuid.UUID,
    changes: dict[str, Any],
) -> AutomationRule:
    rule = get_rule(db, organisation_id, rule_id)
    if rule.archived_at is not None:
        raise ApiError(409, "rule_archived", "An archived rule can't be changed.")
    for field in ("name", "alert_types", "min_severity", "actions", "is_enabled"):
        if field in changes and changes[field] is None:
            raise ApiError(422, "missing_value", "That value is required.")
    if changes.get("vehicle_id"):
        _check_rule_vehicle(db, organisation_id, changes["vehicle_id"])
    if changes.get("actions"):
        _check_action_roles(changes["actions"])
    if changes.get("alert_types"):
        changes["alert_types"] = [item.value for item in changes["alert_types"]]
    for field, value in changes.items():
        setattr(rule, field, value)
    rule.updated_at = utcnow()
    db.add(rule)
    record_audit(
        db,
        "automation_rule.updated",
        actor_user_id=actor_id,
        organisation_id=organisation_id,
        entity_type="automation_rule",
        entity_id=rule.id,
        details={"fields": sorted(changes)},
    )
    _rule_commit(db)
    return rule


def archive_rule(
    db: Session, organisation_id: uuid.UUID, rule_id: uuid.UUID, actor_id: uuid.UUID
) -> AutomationRule:
    rule = get_rule(db, organisation_id, rule_id)
    if rule.archived_at is None:
        rule.archived_at = utcnow()
        rule.is_enabled = False
        db.add(rule)
        record_audit(
            db,
            "automation_rule.archived",
            actor_user_id=actor_id,
            organisation_id=organisation_id,
            entity_type="automation_rule",
            entity_id=rule.id,
        )
        db.commit()
    return rule


def list_runs(
    db: Session,
    organisation_id: uuid.UUID,
    *,
    rule_id: uuid.UUID | None,
    status: AutomationRunStatus | None,
    page: int,
    page_size: int,
) -> tuple[list[Any], int]:
    query = (
        select(AutomationRun, AutomationRule.name, Alert.title)
        .join(AutomationRule, col(AutomationRule.id) == AutomationRun.rule_id)
        .join(Alert, col(Alert.id) == AutomationRun.alert_id)
        .where(AutomationRun.organisation_id == organisation_id)
    )
    if rule_id:
        query = query.where(AutomationRun.rule_id == rule_id)
    if status:
        query = query.where(AutomationRun.status == status)
    total = db.exec(select(func.count()).select_from(query.subquery())).one()
    rows = db.exec(
        query.order_by(col(AutomationRun.created_at).desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return list(rows), total
