import { api, apiDownload } from "@/lib/api/client";

export type ColumnKind = "text" | "number" | "money" | "percent" | "distance" | "date" | "datetime";
export type ReportColumn = { key: string; label: string; kind: ColumnKind };
export type ReportData = {
  key: string;
  title: string;
  start: string;
  end: string;
  tiles: { label: string; value: string }[];
  columns: ReportColumn[];
  rows: Record<string, string | number | null>[];
  notes: string[];
  truncated: boolean;
};
export type ReportSummary = { key: string; title: string; description: string };

export const REPORTS_KEY = ["reports"];

function query(start: string, end: string) {
  const params = new URLSearchParams();
  if (start) params.set("start", start);
  if (end) params.set("end", end);
  return params;
}

export const fetchCatalogue = () => api<ReportSummary[]>("/reports");
export const fetchReport = (key: string, start: string, end: string) =>
  api<ReportData>(`/reports/${key}?${query(start, end)}`);
export function exportReport(key: string, format: "csv" | "pdf", start: string, end: string) {
  const params = query(start, end);
  params.set("format", format);
  return apiDownload(`/reports/${key}/export?${params}`);
}
