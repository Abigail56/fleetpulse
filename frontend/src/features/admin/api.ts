import { api } from "@/lib/api/client";

export type AdminOrganisation = {
  id: string;
  name: string;
  slug: string;
  country_code: string;
  status: "active" | "suspended";
  created_at: string;
  members: number;
  vehicles: number;
  plan: string | null;
  paid_until: string | null;
};
export type AdminUser = {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  is_platform_admin: boolean;
  email_verified: boolean;
  last_login_at: string | null;
  created_at: string;
  organisations: number;
};
export type AdminAudit = {
  id: string;
  occurred_at: string;
  action: string;
  organisation_id: string | null;
  actor_user_id: string | null;
  actor_email: string | null;
  entity_type: string | null;
  entity_id: string | null;
  details: Record<string, unknown>;
};
export type Paged<T> = { items: T[]; total: number; page: number; page_size: number };
export type AdminSystem = {
  services: { name: string; state: "ok" | "unavailable" | "not_configured" }[];
  jobs: { name: string; state: "ok" | "late" | "never" | "unknown"; last_success_at: string | null }[];
  integrations: { name: string; state: "configured" | "not_configured"; detail: string }[];
  counts: {
    organisations: number;
    users: number;
    vehicles: number;
    active_subscriptions: number;
    emails_waiting: number;
    emails_failed: number;
    automation_failed: number;
    active_gps_feeds: number;
  };
};

export const ADMIN_KEY = ["admin"];

function listQuery(search: string, page: number) {
  const params = new URLSearchParams({ page: String(page) });
  if (search) params.set("search", search);
  return params;
}

export const fetchAdminSession = () => api<{ verified: boolean }>("/admin/session");
export const verifyAdmin = (password: string) =>
  api<{ verified: boolean }>("/admin/verify", { method: "POST", body: { password } });
export const fetchOrganisations = (search: string, page: number) =>
  api<Paged<AdminOrganisation>>(`/admin/organisations?${listQuery(search, page)}`);
export const fetchUsers = (search: string, page: number) =>
  api<Paged<AdminUser>>(`/admin/users?${listQuery(search, page)}`);
export function fetchAudit(action: string, page: number) {
  const params = new URLSearchParams({ page: String(page) });
  if (action) params.set("action", action);
  return api<Paged<AdminAudit>>(`/admin/audit?${params}`);
}
export const fetchSystem = () => api<AdminSystem>("/admin/system");
export const adminAction = (path: string, reason: string) =>
  api(`/admin/${path}`, { method: "POST", body: { reason } });
