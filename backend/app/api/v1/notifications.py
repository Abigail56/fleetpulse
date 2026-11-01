import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import DbDep, TenantContext, require_permission
from app.core.permissions import Permission
from app.models import AutomationRule, Notification
from app.models.enums import AutomationRunStatus
from app.schemas.notifications import (
    NotificationList,
    NotificationResponse,
    PreferenceItem,
    PreferencesUpdate,
    RuleCreate,
    RuleResponse,
    RuleUpdate,
    RunList,
    RunResponse,
    UnreadCount,
)
from app.services import notifications as service

router = APIRouter(tags=["notifications"])

# Everyone sees only their own notifications, so being a member is all this needs.
Member = Annotated[TenantContext, Depends(require_permission(Permission.ORGANISATION_VIEW))]
CanAutomate = Annotated[TenantContext, Depends(require_permission(Permission.AUTOMATION_MANAGE))]


def _response(item: Notification) -> NotificationResponse:
    return NotificationResponse(
        id=item.id,
        alert_id=item.alert_id,
        title=item.title,
        body=item.body,
        severity=item.severity,
        read_at=item.read_at,
        email_status=item.email_status,
        created_at=item.created_at,
    )


def _rule_response(rule: AutomationRule) -> RuleResponse:
    return RuleResponse.model_validate(
        {
            "id": rule.id,
            "name": rule.name,
            "is_enabled": rule.is_enabled,
            "alert_types": rule.alert_types,
            "min_severity": rule.min_severity,
            "vehicle_id": rule.vehicle_id,
            "actions": rule.actions,
            "archived_at": rule.archived_at,
            "created_at": rule.created_at,
        }
    )


@router.get("/notifications")
def list_notifications(
    tenant: Member,
    db: DbDep,
    unread: bool = False,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 25,
) -> NotificationList:
    rows, total = service.list_notifications(
        db,
        tenant.organisation.id,
        tenant.user.id,
        unread_only=unread,
        page=page,
        page_size=page_size,
    )
    return NotificationList(
        items=[_response(item) for item in rows], total=total, page=page, page_size=page_size
    )


@router.get("/notifications/unread-count")
def unread_count(tenant: Member, db: DbDep) -> UnreadCount:
    return UnreadCount(unread=service.unread_count(db, tenant.organisation.id, tenant.user.id))


@router.post("/notifications/read-all", status_code=status.HTTP_204_NO_CONTENT)
def read_all(tenant: Member, db: DbDep) -> None:
    service.mark_all_read(db, tenant.organisation.id, tenant.user.id)


@router.get("/notifications/preferences")
def get_preferences(tenant: Member, db: DbDep) -> list[PreferenceItem]:
    return [
        PreferenceItem(alert_type=kind, in_app=in_app, email_mode=mode)
        for kind, in_app, mode in service.preferences(db, tenant.organisation.id, tenant.user.id)
    ]


@router.patch("/notifications/preferences")
def update_preferences(body: PreferencesUpdate, tenant: Member, db: DbDep) -> list[PreferenceItem]:
    service.save_preferences(
        db, tenant.organisation.id, tenant.user.id, body.model_dump()["preferences"]
    )
    return get_preferences(tenant, db)


@router.post("/notifications/{notification_id}/read")
def read_one(notification_id: uuid.UUID, tenant: Member, db: DbDep) -> NotificationResponse:
    return _response(service.mark_read(db, tenant.organisation.id, tenant.user.id, notification_id))


@router.get("/automation/rules")
def list_rules(tenant: CanAutomate, db: DbDep, archived: bool = False) -> list[RuleResponse]:
    return [
        _rule_response(rule) for rule in service.list_rules(db, tenant.organisation.id, archived)
    ]


@router.post("/automation/rules", status_code=status.HTTP_201_CREATED)
def create_rule(body: RuleCreate, tenant: CanAutomate, db: DbDep) -> RuleResponse:
    return _rule_response(
        service.create_rule(db, tenant.organisation.id, tenant.user.id, body.model_dump())
    )


@router.get("/automation/rules/{rule_id}")
def get_rule(rule_id: uuid.UUID, tenant: CanAutomate, db: DbDep) -> RuleResponse:
    return _rule_response(service.get_rule(db, tenant.organisation.id, rule_id))


@router.patch("/automation/rules/{rule_id}")
def update_rule(
    rule_id: uuid.UUID, body: RuleUpdate, tenant: CanAutomate, db: DbDep
) -> RuleResponse:
    return _rule_response(
        service.update_rule(
            db,
            tenant.organisation.id,
            rule_id,
            tenant.user.id,
            body.model_dump(exclude_unset=True),
        )
    )


@router.post("/automation/rules/{rule_id}/archive")
def archive_rule(rule_id: uuid.UUID, tenant: CanAutomate, db: DbDep) -> RuleResponse:
    return _rule_response(service.archive_rule(db, tenant.organisation.id, rule_id, tenant.user.id))


@router.get("/automation/runs")
def list_runs(
    tenant: CanAutomate,
    db: DbDep,
    rule_id: uuid.UUID | None = None,
    run_status: Annotated[AutomationRunStatus | None, Query(alias="status")] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 25,
) -> RunList:
    rows, total = service.list_runs(
        db,
        tenant.organisation.id,
        rule_id=rule_id,
        status=run_status,
        page=page,
        page_size=page_size,
    )
    return RunList(
        items=[
            RunResponse(
                id=run.id,
                rule_id=run.rule_id,
                rule_name=rule_name,
                alert_title=alert_title,
                status=run.status,
                attempts=run.attempts,
                outcome=run.outcome,
                created_at=run.created_at,
                finished_at=run.finished_at,
            )
            for run, rule_name, alert_title in rows
        ],
        total=total,
        page=page,
        page_size=page_size,
    )
