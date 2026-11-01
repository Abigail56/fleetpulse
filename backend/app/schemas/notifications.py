import uuid
from datetime import datetime
from typing import Annotated, Literal, Self

from pydantic import BaseModel, Field, StringConstraints, model_validator

from app.models.enums import (
    AlertSeverity,
    AlertType,
    AutomationRunStatus,
    EmailMode,
    NotificationEmailStatus,
    OrganisationRole,
)
from app.schemas.auth import RequestModel

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
MAX_ACTIONS = 5

# These can't refer to a vehicle, so a rule for them alone can't create a work order.
NO_VEHICLE_TYPES = {AlertType.LICENCE_EXPIRY}


class NotifyAction(RequestModel):
    type: Literal["notify"]
    roles: Annotated[list[OrganisationRole], Field(min_length=1, max_length=8)]
    # On, this emails whatever those people's own preferences say.
    email: bool = False


class CreateWorkOrderAction(RequestModel):
    type: Literal["create_work_order"]
    title: Title | None = None


Action = Annotated[NotifyAction | CreateWorkOrderAction, Field(discriminator="type")]


class RuleCreate(RequestModel):
    name: Name
    alert_types: Annotated[list[AlertType], Field(min_length=1, max_length=20)]
    min_severity: AlertSeverity = AlertSeverity.INFO
    vehicle_id: uuid.UUID | None = None
    actions: Annotated[list[Action], Field(min_length=1, max_length=MAX_ACTIONS)]
    is_enabled: bool = True

    @model_validator(mode="after")
    def work_orders_need_a_vehicle(self) -> Self:
        makes_work = any(isinstance(item, CreateWorkOrderAction) for item in self.actions)
        if makes_work and set(self.alert_types) <= NO_VEHICLE_TYPES:
            raise ValueError("a work order needs an alert about a vehicle")
        return self


class RuleUpdate(RequestModel):
    name: Name | None = None
    alert_types: Annotated[list[AlertType], Field(min_length=1, max_length=20)] | None = None
    min_severity: AlertSeverity | None = None
    vehicle_id: uuid.UUID | None = None
    actions: Annotated[list[Action], Field(min_length=1, max_length=MAX_ACTIONS)] | None = None
    is_enabled: bool | None = None


class RuleResponse(BaseModel):
    id: uuid.UUID
    name: str
    is_enabled: bool
    alert_types: list[AlertType]
    min_severity: AlertSeverity
    vehicle_id: uuid.UUID | None
    actions: list[Action]
    archived_at: datetime | None
    created_at: datetime


class RunResponse(BaseModel):
    id: uuid.UUID
    rule_id: uuid.UUID
    rule_name: str
    alert_title: str
    status: AutomationRunStatus
    attempts: int
    outcome: str | None
    created_at: datetime
    finished_at: datetime | None


class RunList(BaseModel):
    items: list[RunResponse]
    total: int
    page: int
    page_size: int


class NotificationResponse(BaseModel):
    id: uuid.UUID
    alert_id: uuid.UUID
    title: str
    body: str
    severity: AlertSeverity
    read_at: datetime | None
    email_status: NotificationEmailStatus
    created_at: datetime


class NotificationList(BaseModel):
    items: list[NotificationResponse]
    total: int
    page: int
    page_size: int


class UnreadCount(BaseModel):
    unread: int


class PreferenceItem(BaseModel):
    alert_type: AlertType
    in_app: bool
    email_mode: EmailMode


class PreferenceUpdate(RequestModel):
    alert_type: AlertType
    in_app: bool
    email_mode: EmailMode


class PreferencesUpdate(RequestModel):
    preferences: Annotated[list[PreferenceUpdate], Field(min_length=1, max_length=30)]
