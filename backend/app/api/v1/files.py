import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, UploadFile, status

from app.api.deps import DbDep, SettingsDep, TenantContext, require_permission
from app.core.errors import ApiError
from app.core.permissions import Permission, role_has_permission
from app.models import StoredFile
from app.models.enums import FilePurpose
from app.schemas.costs import FileLink, FileResponse
from app.services import compliance as compliance_service
from app.services import files as service

router = APIRouter(prefix="/files", tags=["files"])

# What each file is for decides who may touch it, so the checks below are by purpose.
Member = Annotated[TenantContext, Depends(require_permission(Permission.ORGANISATION_VIEW))]
UPLOAD_PERMISSIONS = {
    FilePurpose.RECEIPT: Permission.COSTS_SUBMIT,
    FilePurpose.DOCUMENT: Permission.COMPLIANCE_MANAGE,
    FilePurpose.INSPECTION: Permission.INSPECTIONS_SUBMIT,
}


def _forbidden() -> ApiError:
    return ApiError(403, "forbidden", "You don't have permission to do that.")


@router.post("", status_code=status.HTTP_201_CREATED)
def upload_file(
    tenant: Member,
    db: DbDep,
    settings: SettingsDep,
    file: Annotated[UploadFile, File()],
    purpose: Annotated[FilePurpose, Form()] = FilePurpose.RECEIPT,
) -> FileResponse:
    if not role_has_permission(tenant.membership.role, UPLOAD_PERMISSIONS[purpose]):
        raise _forbidden()
    stored = service.store_file(db, settings, tenant.organisation.id, tenant.user.id, file, purpose)
    return FileResponse(
        id=stored.id,
        filename=stored.filename,
        content_type=stored.content_type,
        size_bytes=stored.size_bytes,
    )


def _can_read(db: DbDep, tenant: TenantContext, stored: StoredFile) -> bool:
    role = tenant.membership.role
    uploader = stored.uploaded_by_user_id == tenant.user.id
    if stored.purpose == FilePurpose.RECEIPT:
        return uploader or role_has_permission(role, Permission.COSTS_VIEW)
    if stored.purpose == FilePurpose.INSPECTION:
        return uploader or role_has_permission(role, Permission.COMPLIANCE_VIEW)
    document = compliance_service.document_for_file(db, tenant.organisation.id, stored.id)
    if document is None:
        return uploader
    if document.vehicle_id is not None:
        return role_has_permission(role, Permission.COMPLIANCE_VIEW)
    # Driver documents are sensitive: those allowed to see them, and the driver themselves.
    if role_has_permission(role, Permission.DRIVERS_VIEW_SENSITIVE):
        return True
    own = compliance_service.driver_for_user(db, tenant.organisation.id, tenant.user.id)
    return own is not None and bool(own == document.driver_id)


@router.get("/{file_id}/link")
def file_link(file_id: uuid.UUID, tenant: Member, db: DbDep, settings: SettingsDep) -> FileLink:
    """Short-lived, and checked each time, so a link can't outlive someone's access for long."""
    stored = service.get_file(db, tenant.organisation.id, file_id)
    if not _can_read(db, tenant, stored):
        raise ApiError(404, "not_found", "File not found.")
    url, seconds = service.signed_link(settings, stored)
    return FileLink(url=url, expires_in_seconds=seconds)
