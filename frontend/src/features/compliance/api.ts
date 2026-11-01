import { api } from "@/lib/api/client";

export const DOCUMENT_TYPES = [
  "insurance",
  "roadworthiness",
  "registration",
  "permit",
  "licence",
  "medical",
  "training",
  "other",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export const TYPE_LABELS: Record<DocumentType, string> = {
  insurance: "Insurance",
  roadworthiness: "Roadworthiness",
  registration: "Registration",
  permit: "Permit",
  licence: "Licence",
  medical: "Medical",
  training: "Training",
  other: "Other",
};
export type DocumentState = "valid" | "expiring" | "expired" | "no_expiry";
export const STATE_LABELS: Record<DocumentState, string> = {
  valid: "Valid",
  expiring: "Expires soon",
  expired: "Expired",
  no_expiry: "No expiry date",
};
export type Severity = "minor" | "major" | "critical";
export const SEVERITY_LABELS: Record<Severity, string> = {
  minor: "Minor",
  major: "Major",
  critical: "Critical",
};
export type ItemResult = "pass" | "fail" | "not_applicable";
export const RESULT_LABELS: Record<ItemResult, string> = {
  pass: "Pass",
  fail: "Fail",
  not_applicable: "Not applicable",
};

export type StoredFile = { id: string; filename: string; content_type: string; size_bytes: number };
export type ComplianceDocument = {
  id: string;
  vehicle_id: string | null;
  vehicle_registration: string | null;
  driver_id: string | null;
  driver_name: string | null;
  document_type: DocumentType;
  title: string;
  reference_number: string | null;
  issued_on: string | null;
  expires_on: string | null;
  state: DocumentState;
  file: StoredFile | null;
  notes: string | null;
  archived_at: string | null;
};
export type DocumentPayload = {
  vehicle_id?: string;
  driver_id?: string;
  document_type?: DocumentType;
  title?: string;
  reference_number?: string | null;
  issued_on?: string | null;
  expires_on?: string | null;
  file_id?: string | null;
  notes?: string | null;
};
export type TemplateItem = { id: string; label: string; critical: boolean };
export type Template = {
  id: string;
  name: string;
  items: TemplateItem[];
  archived_at: string | null;
};
export type TemplatePayload = {
  name: string;
  items: { id?: string; label: string; critical: boolean }[];
};
export type Inspection = {
  id: string;
  vehicle_id: string;
  vehicle_registration: string;
  template_name: string;
  performed_at: string;
  performed_by_name: string | null;
  odometer_km: string | null;
  outcome: "passed" | "failed";
  results: { label: string; critical: boolean; result: ItemResult; note: string | null }[];
  notes: string | null;
};
export type InspectionPayload = {
  vehicle_id: string;
  template_id: string;
  odometer_km?: string;
  answers: { item_id: string; result: ItemResult; note?: string }[];
  notes?: string;
};
export type Defect = {
  id: string;
  vehicle_id: string;
  vehicle_registration: string;
  inspection_id: string | null;
  title: string;
  description: string | null;
  severity: Severity;
  status: "open" | "resolved";
  photo: StoredFile | null;
  work_order_id: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  created_at: string;
};
export type Paged<T> = { items: T[]; total: number; page: number; page_size: number };
export type ComplianceSummary = {
  expired_documents: number;
  expiring_documents: number;
  open_defects: number;
  critical_defects: number;
  failed_inspections_30_days: number;
};
export type ComplianceOptions = {
  vehicles: { id: string; registration_number: string; make: string; model: string }[];
  drivers: { id: string; name: string }[];
};

export const COMPLIANCE_KEY = ["compliance"];
export const PAGE_SIZE = 25;
const ROOT = "/compliance";

export const fetchSummary = () => api<ComplianceSummary>(`${ROOT}/summary`);
export const fetchOptions = () => api<ComplianceOptions>(`${ROOT}/options`);
export function fetchDocuments(filters: { state?: string; vehicle?: string; driver?: string }) {
  const params = new URLSearchParams();
  if (filters.state) params.set("state", filters.state);
  if (filters.vehicle) params.set("vehicle_id", filters.vehicle);
  if (filters.driver) params.set("driver_id", filters.driver);
  return api<ComplianceDocument[]>(`${ROOT}/documents?${params}`);
}
export const fetchMyDocuments = () => api<ComplianceDocument[]>(`${ROOT}/my-documents`);
export const fetchDocument = (id: string) => api<ComplianceDocument>(`${ROOT}/documents/${id}`);
export const createDocument = (body: DocumentPayload) =>
  api<ComplianceDocument>(`${ROOT}/documents`, { method: "POST", body });
export const updateDocument = (id: string, body: DocumentPayload) =>
  api<ComplianceDocument>(`${ROOT}/documents/${id}`, { method: "PATCH", body });
export const archiveDocument = (id: string) =>
  api<ComplianceDocument>(`${ROOT}/documents/${id}/archive`, { method: "POST" });
export const fetchTemplates = () => api<Template[]>(`${ROOT}/templates`);
export const fetchTemplate = (id: string) => api<Template>(`${ROOT}/templates/${id}`);
export const createTemplate = (body: TemplatePayload) =>
  api<Template>(`${ROOT}/templates`, { method: "POST", body });
export const updateTemplate = (id: string, body: TemplatePayload) =>
  api<Template>(`${ROOT}/templates/${id}`, { method: "PATCH", body });
export const archiveTemplate = (id: string) =>
  api<Template>(`${ROOT}/templates/${id}/archive`, { method: "POST" });
export function fetchInspections(page: number, vehicle = "", pageSize = PAGE_SIZE) {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  if (vehicle) params.set("vehicle_id", vehicle);
  return api<Paged<Inspection>>(`${ROOT}/inspections?${params}`);
}
export const fetchInspection = (id: string) => api<Inspection>(`${ROOT}/inspections/${id}`);
export const createInspection = (body: InspectionPayload) =>
  api<Inspection>(`${ROOT}/inspections`, { method: "POST", body });
export function fetchDefects(filters: { status?: string; vehicle?: string; page?: number }) {
  const params = new URLSearchParams({ page: String(filters.page ?? 1) });
  if (filters.status) params.set("status", filters.status);
  if (filters.vehicle) params.set("vehicle_id", filters.vehicle);
  return api<Paged<Defect>>(`${ROOT}/defects?${params}`);
}
export const createDefect = (body: {
  vehicle_id: string;
  title: string;
  severity: Severity;
  description?: string;
  photo_file_id?: string;
}) => api<Defect>(`${ROOT}/defects`, { method: "POST", body });
export const resolveDefect = (id: string, note: string) =>
  api<Defect>(`${ROOT}/defects/${id}/resolve`, { method: "POST", body: { note: note || null } });
export const createDefectWorkOrder = (id: string) =>
  api<{ id: string }>(`${ROOT}/defects/${id}/work-order`, { method: "POST" });
export function uploadFile(file: File, purpose: "document" | "inspection") {
  const body = new FormData();
  body.set("file", file);
  body.set("purpose", purpose);
  return api<StoredFile>("/files", { method: "POST", body });
}
