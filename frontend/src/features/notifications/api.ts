import type { AlertType, Severity } from "@/features/alerts/api";
import { api } from "@/lib/api/client";

export type EmailMode = "off" | "critical" | "all";
export type EmailStatus = "not_requested" | "pending" | "sent" | "failed";
export type NotificationItem = {
  id: string;
  alert_id: string;
  title: string;
  body: string;
  severity: Severity;
  read_at: string | null;
  email_status: EmailStatus;
  created_at: string;
};
export type NotificationPage = {
  items: NotificationItem[];
  total: number;
  page: number;
  page_size: number;
};
export type Preference = { alert_type: AlertType; in_app: boolean; email_mode: EmailMode };

export const NOTIFICATIONS_KEY = ["notifications"];
export const UNREAD_KEY = [...NOTIFICATIONS_KEY, "unread"];
export const PAGE_SIZE = 25;
export const REFRESH_MS = 30_000;

export const fetchNotifications = (page: number, unread: boolean) =>
  api<NotificationPage>(`/notifications?page=${page}${unread ? "&unread=true" : ""}`);
export const fetchUnreadCount = () => api<{ unread: number }>("/notifications/unread-count");
export const markRead = (id: string) =>
  api<NotificationItem>(`/notifications/${id}/read`, { method: "POST" });
export const markAllRead = () => api("/notifications/read-all", { method: "POST" });
export const fetchPreferences = () => api<Preference[]>("/notifications/preferences");
export const savePreferences = (preferences: Preference[]) =>
  api<Preference[]>("/notifications/preferences", { method: "PATCH", body: { preferences } });
