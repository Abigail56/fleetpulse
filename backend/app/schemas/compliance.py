import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal, Self

from pydantic import AwareDatetime, BaseModel, Field, StringConstraints, model_validator

from app.models.enums import (
    DefectSeverity,
    DefectStatus,
    DocumentType,
    InspectionOutcome,
)
from app.schemas.auth import RequestModel
from app.schemas.costs import FileResponse

Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
Label = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Notes = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]
Reference = Annotated[str, StringConstraints(strip_whitespace=True, max_length=100)]
Kilometres = Annotated[Decimal, Field(ge=0, le=99999999, decimal_places=1)]
DocumentState = Literal["valid", "expiring", "expired", "no_expiry"]
ItemResult = Literal["pass", "fail", "not_applicable"]
MAX_TEMPLATE_ITEMS = 100


class DocumentCreate(RequestModel):
    vehicle_id: uuid.UUID | None = None
    driver_id: uuid.UUID | None = None
    document_type: DocumentType
    title: Title
    reference_number: Reference | None = None
    issued_on: date | None = None
    expires_on: date | None = None
    file_id: uuid.UUID | None = None
    notes: Notes | None = None

    @model_validator(mode="after")
    def belongs_to_one(self) -> Self:
        if (self.vehicle_id is None) == (self.driver_id is None):
            raise ValueError("choose a vehicle or a driver")
        return self


class DocumentUpdate(RequestModel):
    document_type: DocumentType | None = None
    title: Title | None = None
    reference_number: Reference | None = None
    issued_on: date | None = None
    expires_on: date | None = None
    file_id: uuid.UUID | None = None
    notes: Notes | None = None


class DocumentResponse(BaseModel):
    id: uuid.UUID
    vehicle_id: uuid.UUID | None
    vehicle_registration: str | None
    driver_id: uuid.UUID | None
    driver_name: str | None
    document_type: DocumentType
    title: str
    reference_number: str | None
    issued_on: date | None
    expires_on: date | None
    state: DocumentState
    file: FileResponse | None
    notes: str | None
    archived_at: datetime | None


class TemplateItemInput(RequestModel):
    # Sent back when editing, so an item keeps its identity.
    id: uuid.UUID | None = None
    label: Label
    critical: bool = False


class TemplateCreate(RequestModel):
    name: Name
    items: Annotated[list[TemplateItemInput], Field(min_length=1, max_length=MAX_TEMPLATE_ITEMS)]


class TemplateUpdate(RequestModel):
    name: Name | None = None
    items: (
        Annotated[list[TemplateItemInput], Field(min_length=1, max_length=MAX_TEMPLATE_ITEMS)]
        | None
    ) = None


class TemplateItem(BaseModel):
    id: uuid.UUID
    label: str
    critical: bool


class TemplateResponse(BaseModel):
    id: uuid.UUID
    name: str
    items: list[TemplateItem]
    archived_at: datetime | None


class ItemAnswer(RequestModel):
    item_id: uuid.UUID
    result: ItemResult
    note: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] | None = None


class InspectionCreate(RequestModel):
    vehicle_id: uuid.UUID
    template_id: uuid.UUID
    performed_at: AwareDatetime | None = None
    odometer_km: Kilometres | None = None
    answers: Annotated[list[ItemAnswer], Field(min_length=1, max_length=MAX_TEMPLATE_ITEMS)]
    notes: Notes | None = None


class InspectionResult(BaseModel):
    label: str
    critical: bool
    result: ItemResult
    note: str | None


class InspectionResponse(BaseModel):
    id: uuid.UUID
    vehicle_id: uuid.UUID
    vehicle_registration: str
    template_name: str
    performed_at: datetime
    performed_by_name: str | None
    odometer_km: Decimal | None
    outcome: InspectionOutcome
    results: list[InspectionResult]
    notes: str | None


class InspectionList(BaseModel):
    items: list[InspectionResponse]
    total: int
    page: int
    page_size: int


class DefectCreate(RequestModel):
    vehicle_id: uuid.UUID
    title: Title
    description: Notes | None = None
    severity: DefectSeverity
    photo_file_id: uuid.UUID | None = None


class DefectResolve(RequestModel):
    note: Notes | None = None


class DefectResponse(BaseModel):
    id: uuid.UUID
    vehicle_id: uuid.UUID
    vehicle_registration: str
    inspection_id: uuid.UUID | None
    title: str
    description: str | None
    severity: DefectSeverity
    status: DefectStatus
    photo: FileResponse | None
    work_order_id: uuid.UUID | None
    resolved_at: datetime | None
    resolution_note: str | None
    created_at: datetime


class DefectList(BaseModel):
    items: list[DefectResponse]
    total: int
    page: int
    page_size: int


class ComplianceSummary(BaseModel):
    expired_documents: int
    expiring_documents: int
    open_defects: int
    critical_defects: int
    failed_inspections_30_days: int


class ComplianceOptionVehicle(BaseModel):
    id: uuid.UUID
    registration_number: str
    make: str
    model: str


class ComplianceOptionDriver(BaseModel):
    id: uuid.UUID
    name: str


class ComplianceOptions(BaseModel):
    vehicles: list[ComplianceOptionVehicle]
    # Empty for roles that can't see driver documents.
    drivers: list[ComplianceOptionDriver]
