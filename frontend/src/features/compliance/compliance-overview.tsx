"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ClipboardCheck, FileText, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Alert } from "@/components/ui/alert";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { SelectInput, TextInput } from "@/components/ui/field";
import { type Status, StatusBadge } from "@/components/ui/status-badge";
import { ReceiptLink } from "@/features/costs/receipt";
import { MAINTENANCE_KEY } from "@/features/maintenance/api";
import type { CurrentMembership } from "@/features/organisation/api";
import { useUrlFilters } from "@/lib/use-url-filters";

import {
  archiveDocument,
  archiveTemplate,
  COMPLIANCE_KEY,
  type ComplianceDocument,
  createDefectWorkOrder,
  type Defect,
  type DocumentState,
  fetchDefects,
  fetchDocuments,
  fetchInspections,
  fetchMyDocuments,
  fetchSummary,
  fetchTemplates,
  PAGE_SIZE,
  resolveDefect,
  type Severity,
  SEVERITY_LABELS,
  STATE_LABELS,
  TYPE_LABELS,
} from "./api";

const STATE_STYLES: Record<DocumentState, Status> = {
  valid: "success",
  expiring: "warning",
  expired: "error",
  no_expiry: "neutral",
};
const SEVERITY_STYLES: Record<Severity, Status> = {
  minor: "neutral",
  major: "warning",
  critical: "error",
};

type Filters = { state: string; defects: string; page: number };

function readFilters(params: URLSearchParams): Filters {
  return {
    state: params.get("state") ?? "",
    defects: params.get("defects") ?? "open",
    page: Math.max(1, Number(params.get("page")) || 1),
  };
}

export function DocumentRow({ document, canManage }: { document: ComplianceDocument; canManage: boolean }) {
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const archive = useMutation({
    mutationFn: () => archiveDocument(document.id),
    onSuccess: async () => {
      setConfirm(false);
      toast.success("Document archived.");
      await queryClient.invalidateQueries({ queryKey: COMPLIANCE_KEY });
    },
    onError: (error) => {
      setConfirm(false);
      toast.error(error.message);
    },
  });
  return (
    <li className="flex flex-col gap-1 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">
          {document.vehicle_registration ?? document.driver_name} · {document.title}
        </span>
        <StatusBadge status={STATE_STYLES[document.state]}>{STATE_LABELS[document.state]}</StatusBadge>
      </div>
      <p className="text-xs opacity-75">
        {TYPE_LABELS[document.document_type]}
        {document.reference_number && ` · ${document.reference_number}`}
        {document.expires_on && ` · Expires ${format(parseISO(document.expires_on), "d MMM yyyy")}`}
      </p>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        {document.file ? <ReceiptLink file={document.file} /> : <span className="opacity-75">No file attached</span>}
        {canManage && (
          <>
            <Link href={`/compliance/documents/${document.id}/edit`} className="link" aria-label={`Edit ${document.title}`}>
              Edit
            </Link>
            <button type="button" className="link" onClick={() => setConfirm(true)} aria-label={`Archive ${document.title}`}>
              Archive
            </button>
          </>
        )}
      </div>
      {canManage && (
        <ConfirmDialog
          open={confirm}
          title="Archive this document?"
          confirmLabel="Archive"
          busy={archive.isPending}
          onCancel={() => setConfirm(false)}
          onConfirm={() => archive.mutate()}
        >
          It stops sending reminders. The record is kept.
        </ConfirmDialog>
      )}
    </li>
  );
}

function DefectRow({ defect, canManage, canBook }: { defect: Defect; canManage: boolean; canBook: boolean }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [resolving, setResolving] = useState(false);
  const [note, setNote] = useState("");
  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: COMPLIANCE_KEY });
    await queryClient.invalidateQueries({ queryKey: MAINTENANCE_KEY });
  }
  const resolve = useMutation({
    mutationFn: () => resolveDefect(defect.id, note),
    onSuccess: async () => {
      setResolving(false);
      toast.success("Defect resolved.");
      await refresh();
    },
    onError: (error) => {
      setResolving(false);
      toast.error(error.message);
    },
  });
  const book = useMutation({
    mutationFn: () => createDefectWorkOrder(defect.id),
    onSuccess: async ({ id }) => {
      toast.success("Work order created.");
      await refresh();
      router.push(`/maintenance/work-orders/${id}`);
    },
    onError: (error) => toast.error(error.message),
  });
  const open = defect.status === "open";
  return (
    <li className="flex flex-col gap-1 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">
          {defect.vehicle_registration} · {defect.title}
        </span>
        <span className="flex items-center gap-1.5">
          {!open && <StatusBadge status="success">Resolved</StatusBadge>}
          <StatusBadge status={SEVERITY_STYLES[defect.severity]}>{SEVERITY_LABELS[defect.severity]}</StatusBadge>
        </span>
      </div>
      {defect.description && <p className="text-xs opacity-85">{defect.description}</p>}
      <p className="text-xs opacity-75">
        Reported {format(new Date(defect.created_at), "d MMM yyyy")}
        {defect.resolution_note && ` · ${defect.resolution_note}`}
      </p>
      {open && defect.severity === "critical" && (
        <p className="text-xs font-medium">This vehicle can&apos;t be dispatched until this is fixed.</p>
      )}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        {defect.photo && <ReceiptLink file={defect.photo} />}
        {defect.inspection_id && (
          <Link href={`/compliance/inspections/${defect.inspection_id}`} className="link">
            Open inspection
          </Link>
        )}
        {defect.work_order_id && canBook && (
          <Link href={`/maintenance/work-orders/${defect.work_order_id}`} className="link">
            Open work order
          </Link>
        )}
      </div>
      {open && (canManage || canBook) && (
        <div className="mt-1 flex flex-wrap gap-2">
          {canBook && !defect.work_order_id && (
            <Button variant="outline" disabled={book.isPending} onClick={() => book.mutate()}>
              Create work order
            </Button>
          )}
          {canManage && (
            <Button variant="ghost" onClick={() => setResolving(true)}>
              Mark resolved
            </Button>
          )}
        </div>
      )}
      {canManage && open && (
        <ConfirmDialog
          open={resolving}
          title="Mark this defect resolved?"
          confirmLabel="Mark resolved"
          busy={resolve.isPending}
          onCancel={() => setResolving(false)}
          onConfirm={() => resolve.mutate()}
        >
          <label className="flex flex-col gap-1">
            What was done (optional)
            <TextInput value={note} onChange={(event) => setNote(event.target.value)} />
          </label>
        </ConfirmDialog>
      )}
    </li>
  );
}

function Templates({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const templates = useQuery({ queryKey: [...COMPLIANCE_KEY, "templates"], queryFn: fetchTemplates });
  const archive = useMutation({
    mutationFn: archiveTemplate,
    onSuccess: async () => {
      toast.success("Template archived.");
      await queryClient.invalidateQueries({ queryKey: COMPLIANCE_KEY });
    },
    onError: (error) => toast.error(error.message),
  });
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Inspection templates</h2>
        {canManage && (
          <ButtonLink href="/compliance/templates/new" variant="outline">
            <Plus aria-hidden className="size-4" />
            New template
          </ButtonLink>
        )}
      </div>
      {templates.isError && <Alert variant="error">{templates.error.message}</Alert>}
      {templates.data?.length === 0 && (
        <p className="text-sm opacity-75">
          No templates yet. A template is the checklist that inspections follow.
        </p>
      )}
      {templates.data && templates.data.length > 0 && (
        <Card className="overflow-hidden p-0">
          <ul aria-label="Inspection templates" className="divide-y divide-base-300 text-sm">
            {templates.data.map((template) => (
              <li key={template.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span>
                  <span className="font-medium">{template.name}</span>
                  <span className="ml-2 text-xs opacity-75">
                    {template.items.length} {template.items.length === 1 ? "check" : "checks"}
                  </span>
                </span>
                {canManage && (
                  <span className="flex gap-3 text-xs">
                    <Link href={`/compliance/templates/${template.id}/edit`} className="link" aria-label={`Edit ${template.name}`}>
                      Edit
                    </Link>
                    <button
                      type="button"
                      className="link"
                      aria-label={`Archive ${template.name}`}
                      disabled={archive.isPending}
                      onClick={() => archive.mutate(template.id)}
                    >
                      Archive
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}

function MyDocuments() {
  const documents = useQuery({ queryKey: [...COMPLIANCE_KEY, "mine"], queryFn: fetchMyDocuments });
  if (!documents.data?.length && !documents.isError) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold">My documents</h2>
      {documents.isError && <Alert variant="error">{documents.error.message}</Alert>}
      {documents.data && (
        <Card className="overflow-hidden p-0">
          <ul aria-label="My documents" className="divide-y divide-base-300">
            {documents.data.map((document) => (
              <DocumentRow key={document.id} document={document} canManage={false} />
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}

export function ComplianceOverview({ membership }: { membership: CurrentMembership }) {
  const [filters, commitFilters] = useUrlFilters(readFilters);
  const permissions = membership.permissions;
  const seesAll = permissions.includes("compliance.view");
  const canManage = permissions.includes("compliance.manage");
  const canInspect = permissions.includes("inspections.submit");
  const canBook = permissions.includes("maintenance.manage");
  const summary = useQuery({
    queryKey: [...COMPLIANCE_KEY, "summary"],
    queryFn: fetchSummary,
    enabled: seesAll,
  });
  const documents = useQuery({
    queryKey: [...COMPLIANCE_KEY, "documents", filters.state],
    queryFn: () => fetchDocuments({ state: filters.state }),
    enabled: seesAll,
  });
  const defects = useQuery({
    queryKey: [...COMPLIANCE_KEY, "defects", filters.defects],
    queryFn: () => fetchDefects({ status: filters.defects }),
    enabled: canInspect || seesAll,
  });
  const inspections = useQuery({
    queryKey: [...COMPLIANCE_KEY, "inspections", filters.page],
    queryFn: () => fetchInspections(filters.page),
    enabled: canInspect,
  });

  function setFilters(changes: Partial<Filters>) {
    const next = { ...filters, ...changes };
    const params = new URLSearchParams();
    if (next.state) params.set("state", next.state);
    if (next.defects !== "open") params.set("defects", next.defects);
    if (next.page > 1) params.set("page", String(next.page));
    commitFilters(next, params.toString());
  }

  const pages = Math.max(1, Math.ceil((inspections.data?.total ?? 0) / PAGE_SIZE));
  const tiles = summary.data
    ? ([
        ["Documents expired", summary.data.expired_documents],
        ["Documents expiring within 30 days", summary.data.expiring_documents],
        ["Open defects", summary.data.open_defects],
        ["Critical defects", summary.data.critical_defects],
      ] as const)
    : [];

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight">Compliance</h1>
        <div className="flex flex-wrap gap-2">
          {canManage && (
            <ButtonLink href="/compliance/documents/new" variant="outline">
              <Plus aria-hidden className="size-4" />
              Add document
            </ButtonLink>
          )}
          {canInspect && (
            <>
              <ButtonLink href="/compliance/defects/new" variant="outline">
                <Plus aria-hidden className="size-4" />
                Report defect
              </ButtonLink>
              <ButtonLink href="/compliance/inspections/new">
                <Plus aria-hidden className="size-4" />
                New inspection
              </ButtonLink>
            </>
          )}
        </div>
      </div>
      {summary.isError && <Alert variant="error">{summary.error.message}</Alert>}
      {summary.data && (
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {tiles.map(([label, value]) => (
            <Card key={label}>
              <dt className="text-sm opacity-75">{label}</dt>
              <dd className="mt-1 text-2xl font-bold tabular-nums">{value}</dd>
            </Card>
          ))}
        </dl>
      )}
      <MyDocuments />
      {(canInspect || seesAll) && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-xl font-semibold">Defects</h2>
            <label className="flex flex-col gap-1 text-sm">
              Show
              <SelectInput
                value={filters.defects}
                onChange={(event) => setFilters({ defects: event.target.value })}
              >
                <option value="open">Open</option>
                <option value="resolved">Resolved</option>
                <option value="">All</option>
              </SelectInput>
            </label>
          </div>
          {defects.isPending && <p role="status" className="text-sm opacity-75">Loading defects…</p>}
          {defects.isError && <Alert variant="error">{defects.error.message}</Alert>}
          {defects.data?.total === 0 && (
            <p className="text-sm opacity-75">
              {filters.defects === "open" ? "No open defects." : "No defects to show."}
            </p>
          )}
          {defects.data && defects.data.total > 0 && (
            <Card className="overflow-hidden p-0">
              <ul aria-label="Defects" className="divide-y divide-base-300">
                {defects.data.items.map((defect) => (
                  <DefectRow key={defect.id} defect={defect} canManage={canManage} canBook={canBook} />
                ))}
              </ul>
            </Card>
          )}
          {defects.data && defects.data.total > defects.data.items.length && (
            <p className="text-xs opacity-75">
              Showing the newest {defects.data.items.length} of {defects.data.total}.
            </p>
          )}
        </section>
      )}
      {seesAll && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-xl font-semibold">Documents</h2>
            <label className="flex flex-col gap-1 text-sm">
              Status
              <SelectInput value={filters.state} onChange={(event) => setFilters({ state: event.target.value })}>
                <option value="">All</option>
                {(Object.keys(STATE_LABELS) as DocumentState[]).map((state) => (
                  <option key={state} value={state}>
                    {STATE_LABELS[state]}
                  </option>
                ))}
              </SelectInput>
            </label>
          </div>
          {documents.isPending && <p role="status" className="text-sm opacity-75">Loading documents…</p>}
          {documents.isError && <Alert variant="error">{documents.error.message}</Alert>}
          {documents.data?.length === 0 &&
            (filters.state ? (
              <p className="text-sm">No documents match this filter.</p>
            ) : (
              <EmptyState
                icon={FileText}
                title="No documents yet"
                action={canManage ? <ButtonLink href="/compliance/documents/new">Add a document</ButtonLink> : undefined}
              >
                Keep insurance, roadworthiness and licences here, and FleetPulse reminds you before they expire.
              </EmptyState>
            ))}
          {documents.data && documents.data.length > 0 && (
            <Card className="overflow-hidden p-0">
              <ul aria-label="Documents" className="divide-y divide-base-300">
                {documents.data.map((document) => (
                  <DocumentRow key={document.id} document={document} canManage={canManage} />
                ))}
              </ul>
            </Card>
          )}
        </section>
      )}
      {canInspect && (
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">Inspections</h2>
          {inspections.isPending && <p role="status" className="text-sm opacity-75">Loading inspections…</p>}
          {inspections.isError && <Alert variant="error">{inspections.error.message}</Alert>}
          {inspections.data?.total === 0 && (
            <EmptyState icon={ClipboardCheck} title="No inspections yet">
              Completed inspections and their results appear here.
            </EmptyState>
          )}
          {inspections.data && inspections.data.total > 0 && (
            <>
              <Card className="overflow-hidden p-0">
                <ul aria-label="Inspections" className="divide-y divide-base-300 text-sm">
                  {inspections.data.items.map((inspection) => (
                    <li key={inspection.id}>
                      <Link
                        href={`/compliance/inspections/${inspection.id}`}
                        className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 transition-colors hover:bg-base-200"
                      >
                        <span>
                          <span className="font-medium">
                            {inspection.vehicle_registration} · {inspection.template_name}
                          </span>
                          <span className="block text-xs opacity-75">
                            {format(new Date(inspection.performed_at), "d MMM yyyy, HH:mm")}
                            {inspection.performed_by_name && ` by ${inspection.performed_by_name}`}
                          </span>
                        </span>
                        <StatusBadge status={inspection.outcome === "passed" ? "success" : "error"}>
                          {inspection.outcome === "passed" ? "Passed" : "Failed"}
                        </StatusBadge>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
              {pages > 1 && (
                <div className="flex items-center gap-2 text-sm">
                  <Button variant="outline" disabled={filters.page <= 1} onClick={() => setFilters({ page: filters.page - 1 })}>
                    Previous
                  </Button>
                  Page {filters.page} of {pages}
                  <Button variant="outline" disabled={filters.page >= pages} onClick={() => setFilters({ page: filters.page + 1 })}>
                    Next
                  </Button>
                </div>
              )}
            </>
          )}
        </section>
      )}
      {canInspect && <Templates canManage={canManage} />}
    </div>
  );
}
