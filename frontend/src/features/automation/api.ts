import type { AlertType, Severity } from "@/features/alerts/api";
import { api } from "@/lib/api/client";

// Only roles that can view alerts: the API refuses any others.
export const NOTIFY_ROLES = [
  "owner",
  "administrator",
  "fleet_manager",
  "dispatcher",
  "maintenance_manager",
  "finance_manager",
  "read_only",
] as const;
export type NotifyRole = (typeof NOTIFY_ROLES)[number];
export const ROLE_LABELS: Record<NotifyRole, string> = {
  owner: "Owners",
  administrator: "Administrators",
  fleet_manager: "Fleet managers",
  dispatcher: "Dispatchers",
  maintenance_manager: "Maintenance managers",
  finance_manager: "Finance managers",
  read_only: "Read-only members",
};

export type NotifyAction = { type: "notify"; roles: NotifyRole[]; email: boolean };
export type WorkOrderAction = { type: "create_work_order"; title: string | null };
export type RuleAction = NotifyAction | WorkOrderAction;
export type Rule = {
  id: string;
  name: string;
  is_enabled: boolean;
  alert_types: AlertType[];
  min_severity: Severity;
  vehicle_id: string | null;
  actions: RuleAction[];
  archived_at: string | null;
  created_at: string;
};
export type RulePayload = {
  name: string;
  alert_types: AlertType[];
  min_severity: Severity;
  vehicle_id?: string | null;
  actions: RuleAction[];
  is_enabled?: boolean;
};
export type RunStatus = "pending" | "succeeded" | "skipped" | "failed";
export const RUN_LABELS: Record<RunStatus, string> = {
  pending: "Waiting",
  succeeded: "Succeeded",
  skipped: "Skipped",
  failed: "Failed",
};
export type Run = {
  id: string;
  rule_id: string;
  rule_name: string;
  alert_title: string;
  status: RunStatus;
  attempts: number;
  outcome: string | null;
  created_at: string;
  finished_at: string | null;
};
export type RunPage = { items: Run[]; total: number; page: number; page_size: number };

export const AUTOMATION_KEY = ["automation"];
export const PAGE_SIZE = 25;

export const fetchRules = () => api<Rule[]>("/automation/rules");
export const fetchRule = (id: string) => api<Rule>(`/automation/rules/${id}`);
export const createRule = (body: RulePayload) =>
  api<Rule>("/automation/rules", { method: "POST", body });
export const updateRule = (id: string, body: Partial<RulePayload>) =>
  api<Rule>(`/automation/rules/${id}`, { method: "PATCH", body });
export const archiveRule = (id: string) =>
  api<Rule>(`/automation/rules/${id}/archive`, { method: "POST" });
export function fetchRuns(page: number, status: string) {
  const params = new URLSearchParams({ page: String(page) });
  if (status) params.set("status", status);
  return api<RunPage>(`/automation/runs?${params}`);
}
