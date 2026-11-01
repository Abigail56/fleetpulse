from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Response

from app.api.deps import DbDep, TenantContext, require_permission
from app.core.permissions import Permission, role_has_permission
from app.schemas.reports import ReportColumn, ReportResponse, ReportSummary, ReportTile
from app.services import reports as service
from app.services.audit import record_audit

router = APIRouter(prefix="/reports", tags=["reports"])

CanView = Annotated[TenantContext, Depends(require_permission(Permission.REPORTS_VIEW))]


def _build(
    tenant: TenantContext, db: DbDep, key: str, start: date | None, end: date | None
) -> service.Report:
    period = service.period_for(start, end, tenant.organisation.timezone)
    return service.build(
        db,
        tenant.organisation.id,
        key,
        period,
        role_has_permission(tenant.membership.role, Permission.DRIVERS_VIEW_SENSITIVE),
    )


@router.get("")
def list_reports(tenant: CanView) -> list[ReportSummary]:
    _ = tenant
    return [
        ReportSummary(key=key, title=title, description=description)
        for key, (title, description) in service.CATALOGUE.items()
    ]


@router.get("/{key}")
def get_report(
    key: str, tenant: CanView, db: DbDep, start: date | None = None, end: date | None = None
) -> ReportResponse:
    report = _build(tenant, db, key, start, end)
    return ReportResponse(
        key=report.key,
        title=report.title,
        start=report.start,
        end=report.end,
        tiles=[ReportTile(**tile) for tile in report.tiles],
        columns=[ReportColumn.model_validate(column) for column in report.columns],
        rows=report.rows,
        notes=report.notes,
        truncated=report.truncated,
    )


@router.get("/{key}/export")
def export_report(
    key: str,
    tenant: CanView,
    db: DbDep,
    export_format: Annotated[Literal["csv", "pdf"], Query(alias="format")] = "csv",
    start: date | None = None,
    end: date | None = None,
) -> Response:
    report = _build(tenant, db, key, start, end)
    # A copy leaving the system is worth a record, unlike viewing one.
    record_audit(
        db,
        "report.exported",
        actor_user_id=tenant.user.id,
        organisation_id=tenant.organisation.id,
        entity_type="report",
        details={"report": key, "format": export_format},
    )
    db.commit()
    name = f"fleetpulse-{key}-{report.start}-to-{report.end}.{export_format}"
    headers = {"Content-Disposition": f'attachment; filename="{name}"'}
    if export_format == "pdf":
        content = service.to_pdf(report, tenant.organisation.name)
        return Response(content, media_type="application/pdf", headers=headers)
    return Response(service.to_csv(report), media_type="text/csv; charset=utf-8", headers=headers)
