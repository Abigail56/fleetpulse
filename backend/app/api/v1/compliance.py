import uuid
from datetime import date, datetime
from typing import Annotated, Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import DbDep, TenantContext, require_permission
from app.api.v1.maintenance import _order_response
from app.core.permissions import Permission, role_has_permission
from app.models import InspectionTemplate
from app.models.enums import DefectSeverity, DefectStatus, InspectionOutcome
from app.schemas.compliance import (
    ComplianceOptionDriver,
    ComplianceOptions,
    ComplianceOptionVehicle,
    ComplianceSummary,
    DefectCreate,
    DefectList,
    DefectResolve,
    DefectResponse,
    DocumentCreate,
    DocumentResponse,
    DocumentState,
    DocumentUpdate,
    InspectionCreate,
    InspectionList,
    InspectionResponse,
    InspectionResult,
    TemplateCreate,
    TemplateItem,
    TemplateResponse,
    TemplateUpdate,
)
from app.schemas.costs import FileResponse
from app.schemas.maintenance import WorkOrderResponse
from app.services import compliance as service
from app.services import maintenance as maintenance_service
from app.services.alerts import document_state

router = APIRouter(prefix="/compliance", tags=["compliance"])

CanView = Annotated[TenantContext, Depends(require_permission(Permission.COMPLIANCE_VIEW))]
CanManage = Annotated[TenantContext, Depends(require_permission(Permission.COMPLIANCE_MANAGE))]
CanInspect = Annotated[TenantContext, Depends(require_permission(Permission.INSPECTIONS_SUBMIT))]
Anyone = Annotated[TenantContext, Depends(require_permission(Permission.ORGANISATION_VIEW))]
CanWorkOrder = Annotated[TenantContext, Depends(require_permission(Permission.MAINTENANCE_MANAGE))]


def _today(tenant: TenantContext) -> date:
    return datetime.now(ZoneInfo(tenant.organisation.timezone)).date()


def _can(tenant: TenantContext, permission: Permission) -> bool:
    return role_has_permission(tenant.membership.role, permission)


def _sees_all(tenant: TenantContext) -> bool:
    return _can(tenant, Permission.COMPLIANCE_VIEW)


def _only_user(tenant: TenantContext) -> uuid.UUID | None:
    return None if _sees_all(tenant) else tenant.user.id


def _sees_driver_documents(tenant: TenantContext) -> bool:
    return _can(tenant, Permission.DRIVERS_VIEW_SENSITIVE)


def _file(stored: Any) -> FileResponse | None:
    if stored is None:
        return None
    return FileResponse(
        id=stored.id,
        filename=stored.filename,
        content_type=stored.content_type,
        size_bytes=stored.size_bytes,
    )


def _document_response(row: Any, today: date) -> DocumentResponse:
    document, registration, first_name, last_name, stored = row
    return DocumentResponse(
        id=document.id,
        vehicle_id=document.vehicle_id,
        vehicle_registration=registration,
        driver_id=document.driver_id,
        driver_name=f"{first_name} {last_name}" if first_name else None,
        document_type=document.document_type,
        title=document.title,
        reference_number=document.reference_number,
        issued_on=document.issued_on,
        expires_on=document.expires_on,
        state=document_state(document.expires_on, today),
        file=_file(stored),
        notes=document.notes,
        archived_at=document.archived_at,
    )


def _template_response(template: InspectionTemplate) -> TemplateResponse:
    return TemplateResponse(
        id=template.id,
        name=template.name,
        items=[TemplateItem(**item) for item in template.items],
        archived_at=template.archived_at,
    )


def _inspection_response(row: Any) -> InspectionResponse:
    inspection, registration, name = row
    return InspectionResponse(
        id=inspection.id,
        vehicle_id=inspection.vehicle_id,
        vehicle_registration=registration,
        template_name=inspection.template_name,
        performed_at=inspection.performed_at,
        performed_by_name=name,
        odometer_km=inspection.odometer_km,
        outcome=inspection.outcome,
        results=[InspectionResult(**item) for item in inspection.results],
        notes=inspection.notes,
    )


def _defect_response(row: Any) -> DefectResponse:
    defect, registration, stored = row
    return DefectResponse(
        id=defect.id,
        vehicle_id=defect.vehicle_id,
        vehicle_registration=registration,
        inspection_id=defect.inspection_id,
        title=defect.title,
        description=defect.description,
        severity=defect.severity,
        status=defect.status,
        photo=_file(stored),
        work_order_id=defect.work_order_id,
        resolved_at=defect.resolved_at,
        resolution_note=defect.resolution_note,
        created_at=defect.created_at,
    )


@router.get("/summary")
def compliance_summary(tenant: CanView, db: DbDep) -> ComplianceSummary:
    expired, expiring, defects, critical, failed = service.summary(
        db, tenant.organisation.id, _today(tenant)
    )
    return ComplianceSummary(
        expired_documents=expired,
        expiring_documents=expiring,
        open_defects=defects,
        critical_defects=critical,
        failed_inspections_30_days=failed,
    )


@router.get("/options")
def compliance_options(tenant: CanInspect, db: DbDep) -> ComplianceOptions:
    vehicles, drivers = service.options(
        db,
        tenant.organisation.id,
        tenant.user.id,
        _sees_all(tenant),
        _can(tenant, Permission.COMPLIANCE_MANAGE) and _sees_driver_documents(tenant),
    )
    return ComplianceOptions(
        vehicles=[
            ComplianceOptionVehicle(
                id=item.id,
                registration_number=item.registration_number,
                make=item.make,
                model=item.model,
            )
            for item in vehicles
        ],
        drivers=[
            ComplianceOptionDriver(id=item.id, name=f"{item.first_name} {item.last_name}")
            for item in drivers
        ],
    )


@router.get("/documents")
def list_documents(
    tenant: CanView,
    db: DbDep,
    vehicle_id: uuid.UUID | None = None,
    driver_id: uuid.UUID | None = None,
    state: DocumentState | None = None,
    archived: bool = False,
) -> list[DocumentResponse]:
    today = _today(tenant)
    rows = service.list_documents(
        db,
        tenant.organisation.id,
        today,
        include_driver_documents=_sees_driver_documents(tenant),
        only_driver_id=None,
        vehicle_id=vehicle_id,
        driver_id=driver_id,
        state=state,
        archived=archived,
    )
    return [_document_response(row, today) for row in rows]


@router.get("/my-documents")
def my_documents(tenant: Anyone, db: DbDep) -> list[DocumentResponse]:
    """A driver's own documents, whatever else their role can see."""
    organisation_id = tenant.organisation.id
    driver_id = service.driver_for_user(db, organisation_id, tenant.user.id)
    if driver_id is None:
        return []
    today = _today(tenant)
    rows = service.list_documents(
        db,
        organisation_id,
        today,
        include_driver_documents=False,
        only_driver_id=driver_id,
        vehicle_id=None,
        driver_id=None,
        state=None,
        archived=False,
    )
    return [_document_response(row, today) for row in rows]


@router.post("/documents", status_code=status.HTTP_201_CREATED)
def create_document(body: DocumentCreate, tenant: CanManage, db: DbDep) -> DocumentResponse:
    organisation_id = tenant.organisation.id
    can_see = _sees_driver_documents(tenant)
    document = service.create_document(
        db, organisation_id, tenant.user.id, can_see, body.model_dump()
    )
    row = service.get_document_row(
        db, organisation_id, document.id, include_driver_documents=can_see
    )
    return _document_response(row, _today(tenant))


@router.get("/documents/{document_id}")
def get_document(document_id: uuid.UUID, tenant: CanView, db: DbDep) -> DocumentResponse:
    row = service.get_document_row(
        db,
        tenant.organisation.id,
        document_id,
        include_driver_documents=_sees_driver_documents(tenant),
    )
    return _document_response(row, _today(tenant))


@router.patch("/documents/{document_id}")
def update_document(
    document_id: uuid.UUID, body: DocumentUpdate, tenant: CanManage, db: DbDep
) -> DocumentResponse:
    organisation_id = tenant.organisation.id
    can_see = _sees_driver_documents(tenant)
    service.update_document(
        db,
        organisation_id,
        document_id,
        tenant.user.id,
        can_see,
        body.model_dump(exclude_unset=True),
    )
    row = service.get_document_row(
        db, organisation_id, document_id, include_driver_documents=can_see
    )
    return _document_response(row, _today(tenant))


@router.post("/documents/{document_id}/archive")
def archive_document(document_id: uuid.UUID, tenant: CanManage, db: DbDep) -> DocumentResponse:
    organisation_id = tenant.organisation.id
    can_see = _sees_driver_documents(tenant)
    service.archive_document(db, organisation_id, document_id, tenant.user.id, can_see)
    row = service.get_document_row(
        db, organisation_id, document_id, include_driver_documents=can_see
    )
    return _document_response(row, _today(tenant))


@router.get("/templates")
def list_templates(tenant: CanInspect, db: DbDep, archived: bool = False) -> list[TemplateResponse]:
    return [
        _template_response(item)
        for item in service.list_templates(db, tenant.organisation.id, archived)
    ]


@router.post("/templates", status_code=status.HTTP_201_CREATED)
def create_template(body: TemplateCreate, tenant: CanManage, db: DbDep) -> TemplateResponse:
    return _template_response(
        service.create_template(db, tenant.organisation.id, tenant.user.id, body.model_dump())
    )


@router.get("/templates/{template_id}")
def get_template(template_id: uuid.UUID, tenant: CanInspect, db: DbDep) -> TemplateResponse:
    return _template_response(service.get_template(db, tenant.organisation.id, template_id))


@router.patch("/templates/{template_id}")
def update_template(
    template_id: uuid.UUID, body: TemplateUpdate, tenant: CanManage, db: DbDep
) -> TemplateResponse:
    return _template_response(
        service.update_template(
            db,
            tenant.organisation.id,
            template_id,
            tenant.user.id,
            body.model_dump(exclude_unset=True),
        )
    )


@router.post("/templates/{template_id}/archive")
def archive_template(template_id: uuid.UUID, tenant: CanManage, db: DbDep) -> TemplateResponse:
    return _template_response(
        service.archive_template(db, tenant.organisation.id, template_id, tenant.user.id)
    )


@router.get("/inspections")
def list_inspections(
    tenant: CanInspect,
    db: DbDep,
    vehicle_id: uuid.UUID | None = None,
    outcome: InspectionOutcome | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 25,
) -> InspectionList:
    rows, total = service.list_inspections(
        db,
        tenant.organisation.id,
        only_user=_only_user(tenant),
        vehicle_id=vehicle_id,
        outcome=outcome,
        page=page,
        page_size=page_size,
    )
    return InspectionList(
        items=[_inspection_response(row) for row in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post("/inspections", status_code=status.HTTP_201_CREATED)
def create_inspection(body: InspectionCreate, tenant: CanInspect, db: DbDep) -> InspectionResponse:
    organisation_id = tenant.organisation.id
    inspection = service.create_inspection(
        db, organisation_id, tenant.user.id, _sees_all(tenant), body.model_dump()
    )
    return _inspection_response(
        service.get_inspection_row(db, organisation_id, inspection.id, None)
    )


@router.get("/inspections/{inspection_id}")
def get_inspection(inspection_id: uuid.UUID, tenant: CanInspect, db: DbDep) -> InspectionResponse:
    return _inspection_response(
        service.get_inspection_row(db, tenant.organisation.id, inspection_id, _only_user(tenant))
    )


@router.get("/defects")
def list_defects(
    tenant: CanInspect,
    db: DbDep,
    defect_status: Annotated[DefectStatus | None, Query(alias="status")] = None,
    severity: DefectSeverity | None = None,
    vehicle_id: uuid.UUID | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 25,
) -> DefectList:
    rows, total = service.list_defects(
        db,
        tenant.organisation.id,
        only_user=_only_user(tenant),
        status=defect_status,
        severity=severity,
        vehicle_id=vehicle_id,
        page=page,
        page_size=page_size,
    )
    return DefectList(
        items=[_defect_response(row) for row in rows], total=total, page=page, page_size=page_size
    )


@router.post("/defects", status_code=status.HTTP_201_CREATED)
def create_defect(body: DefectCreate, tenant: CanInspect, db: DbDep) -> DefectResponse:
    organisation_id = tenant.organisation.id
    defect = service.create_defect(
        db, organisation_id, tenant.user.id, _sees_all(tenant), body.model_dump()
    )
    return _defect_response(service.get_defect_row(db, organisation_id, defect.id, None))


@router.post("/defects/{defect_id}/resolve")
def resolve_defect(
    defect_id: uuid.UUID, body: DefectResolve, tenant: CanManage, db: DbDep
) -> DefectResponse:
    organisation_id = tenant.organisation.id
    service.resolve_defect(db, organisation_id, defect_id, tenant.user.id, body.note)
    return _defect_response(service.get_defect_row(db, organisation_id, defect_id, None))


@router.post("/defects/{defect_id}/work-order", status_code=status.HTTP_201_CREATED)
def defect_work_order(defect_id: uuid.UUID, tenant: CanWorkOrder, db: DbDep) -> WorkOrderResponse:
    organisation = tenant.organisation
    order = service.create_work_order(
        db, organisation.id, defect_id, tenant.user.id, organisation.default_currency
    )
    return _order_response(maintenance_service.get_work_order_row(db, organisation.id, order.id))
