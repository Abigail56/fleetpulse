import { api } from "@/lib/api/client";

export type ScheduleState = "ok" | "due_soon" | "overdue";
export const STATE_LABELS: Record<ScheduleState, string> = {
  ok: "Not due",
  due_soon: "Due soon",
  overdue: "Overdue",
};

export type Schedule = {
  id: string;
  vehicle_id: string;
  vehicle_registration: string;
  vehicle_odometer_km: string;
  odometer_recorded_at: string | null;
  name: string;
  interval_days: number | null;
  interval_km: string | null;
  warn_days: number;
  warn_km: string;
  last_service_on: string;
  last_service_km: string;
  next_due_on: string | null;
  next_due_km: string | null;
  state: ScheduleState;
  open_work_order_id: string | null;
  notes: string | null;
  archived_at: string | null;
};

export type SchedulePayload = {
  vehicle_id?: string;
  name?: string;
  interval_days?: number | null;
  interval_km?: string | null;
  warn_days?: number;
  warn_km?: string;
  last_service_on?: string;
  last_service_km?: string;
  notes?: string | null;
};

export const WORK_ORDER_STATUSES = ["open", "in_progress", "completed", "cancelled"] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];
export const STATUS_LABELS: Record<WorkOrderStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};
export type WorkType = "preventive" | "corrective";
export const TYPE_LABELS: Record<WorkType, string> = {
  preventive: "Preventive",
  corrective: "Corrective",
};

export type WorkOrder = {
  id: string;
  vehicle_id: string;
  vehicle_registration: string;
  schedule_id: string | null;
  work_type: WorkType;
  status: WorkOrderStatus;
  title: string;
  description: string | null;
  scheduled_for: string | null;
  provider_name: string | null;
  provider_phone: string | null;
  provider_email: string | null;
  started_at: string | null;
  took_off_road: boolean;
  completed_on: string | null;
  odometer_km: string | null;
  labour_cost: string | null;
  parts_cost: string | null;
  total_cost: string | null;
  currency: string;
  completion_notes: string | null;
  created_at: string;
};

export type WorkOrderPayload = {
  vehicle_id?: string;
  schedule_id?: string | null;
  work_type?: WorkType;
  title?: string;
  description?: string | null;
  scheduled_for?: string | null;
  provider_name?: string | null;
  provider_phone?: string | null;
  provider_email?: string | null;
};

export type WorkOrderCompletion = {
  completed_on?: string;
  odometer_km?: string;
  labour_cost?: string;
  parts_cost?: string;
  completion_notes?: string;
};

export type WorkOrderFilters = {
  search: string;
  status: string;
  type: string;
  vehicle: string;
  page: number;
};

export type Paged<T> = { items: T[]; total: number; page: number; page_size: number };
export type MaintenanceSummary = {
  overdue: number;
  due_soon: number;
  open_work_orders: number;
  in_progress_work_orders: number;
  recent_costs: { currency: string; amount: string }[];
};
export type VehicleOption = {
  id: string;
  registration_number: string;
  make: string;
  model: string;
  odometer_km: string;
};

export const MAINTENANCE_KEY = ["maintenance"];
export const PAGE_SIZE = 25;

export const fetchSummary = () => api<MaintenanceSummary>("/maintenance/summary");
export const fetchVehicleOptions = () => api<VehicleOption[]>("/maintenance/vehicle-options");

export function fetchSchedules(filters: { state?: string; vehicle?: string; page?: number }) {
  const params = new URLSearchParams({ page: String(filters.page ?? 1) });
  if (filters.state) params.set("state", filters.state);
  if (filters.vehicle) params.set("vehicle_id", filters.vehicle);
  return api<Paged<Schedule>>(`/maintenance/schedules?${params}`);
}
export const fetchSchedule = (id: string) => api<Schedule>(`/maintenance/schedules/${id}`);
export const createSchedule = (body: SchedulePayload) =>
  api<Schedule>("/maintenance/schedules", { method: "POST", body });
export const updateSchedule = (id: string, body: SchedulePayload) =>
  api<Schedule>(`/maintenance/schedules/${id}`, { method: "PATCH", body });
export const archiveSchedule = (id: string) =>
  api<Schedule>(`/maintenance/schedules/${id}/archive`, { method: "POST" });

export function fetchWorkOrders(filters: WorkOrderFilters, pageSize = PAGE_SIZE) {
  const params = new URLSearchParams({
    page: String(filters.page),
    page_size: String(pageSize),
  });
  if (filters.search) params.set("search", filters.search);
  if (filters.status) params.set("status", filters.status);
  if (filters.type) params.set("work_type", filters.type);
  if (filters.vehicle) params.set("vehicle_id", filters.vehicle);
  return api<Paged<WorkOrder>>(`/maintenance/work-orders?${params}`);
}
export const fetchWorkOrder = (id: string) => api<WorkOrder>(`/maintenance/work-orders/${id}`);
export const createWorkOrder = (body: WorkOrderPayload) =>
  api<WorkOrder>("/maintenance/work-orders", { method: "POST", body });
export const updateWorkOrder = (id: string, body: WorkOrderPayload) =>
  api<WorkOrder>(`/maintenance/work-orders/${id}`, { method: "PATCH", body });
export const startWorkOrder = (id: string, takeOffRoad: boolean) =>
  api<WorkOrder>(`/maintenance/work-orders/${id}/start`, {
    method: "POST",
    body: { take_off_road: takeOffRoad },
  });
export const completeWorkOrder = (id: string, body: WorkOrderCompletion) =>
  api<WorkOrder>(`/maintenance/work-orders/${id}/complete`, { method: "POST", body });
export const cancelWorkOrder = (id: string) =>
  api<WorkOrder>(`/maintenance/work-orders/${id}/cancel`, { method: "POST" });
