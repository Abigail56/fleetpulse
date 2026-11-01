import { api } from "@/lib/api/client";

export const ALERT_TYPES = [
  "geofence_entry",
  "geofence_exit",
  "speeding",
  "unusual_movement",
  "vehicle_offline",
  "licence_expiry",
  "maintenance_due",
  "document_expiry",
  "defect_reported",
] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

export const TYPE_LABELS: Record<AlertType, string> = {
  geofence_entry: "Geofence entry",
  geofence_exit: "Geofence exit",
  speeding: "Speeding",
  unusual_movement: "Unusual movement",
  vehicle_offline: "Stopped reporting",
  licence_expiry: "Licence expiry",
  maintenance_due: "Maintenance due",
  document_expiry: "Document expiry",
  defect_reported: "Defect reported",
};

export const SEVERITIES = ["critical", "warning", "info"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const SEVERITY_LABELS: Record<Severity, string> = {
  critical: "Critical",
  warning: "Warning",
  info: "Information",
};

export const STATES = [
  { value: "active", label: "Active" },
  { value: "unacknowledged", label: "Not acknowledged" },
  { value: "resolved", label: "Resolved" },
  { value: "all", label: "All" },
] as const;

export type AlertItem = {
  id: string;
  alert_type: AlertType;
  severity: Severity;
  title: string;
  message: string;
  occurred_at: string;
  vehicle_id: string | null;
  vehicle_registration: string | null;
  driver_id: string | null;
  geofence_id: string | null;
  is_simulated: boolean;
  acknowledged_at: string | null;
  resolved_at: string | null;
};

export type AlertFilters = { state: string; type: string; severity: string; page: number };
export type AlertPage = { items: AlertItem[]; total: number; page: number; page_size: number };
export type AlertSummary = { unacknowledged: number; critical: number };
export type AlertSettings = {
  speed_limit_kph: number | null;
  offline_alerts_enabled: boolean;
  offline_minutes: number;
  licence_alerts_enabled: boolean;
  maintenance_alerts_enabled: boolean;
  document_alerts_enabled: boolean;
};

export const ALERTS_KEY = ["alerts"];
export const SUMMARY_KEY = [...ALERTS_KEY, "summary"];
export const PAGE_SIZE = 25;
export const ALERT_REFRESH_MS = 30_000;

export function fetchAlerts(filters: AlertFilters) {
  const params = new URLSearchParams({ state: filters.state, page: String(filters.page) });
  if (filters.type) params.set("alert_type", filters.type);
  if (filters.severity) params.set("severity", filters.severity);
  return api<AlertPage>(`/alerts?${params}`);
}
export const fetchAlertSummary = () => api<AlertSummary>("/alerts/summary");
export const fetchAlertSettings = () => api<AlertSettings>("/alerts/settings");
export const updateAlertSettings = (body: Partial<AlertSettings>) =>
  api<AlertSettings>("/alerts/settings", { method: "PATCH", body });
export const acknowledgeAlert = (id: string) =>
  api<AlertItem>(`/alerts/${id}/acknowledge`, { method: "POST" });
export const resolveAlert = (id: string) =>
  api<AlertItem>(`/alerts/${id}/resolve`, { method: "POST" });
