import { api } from "@/lib/api/client";

export const DRIVER_STATUSES = ["active", "inactive", "suspended"] as const;
export const AVAILABILITIES = ["available", "on_trip", "off_duty", "unavailable"] as const;

export type DriverStatus = (typeof DRIVER_STATUSES)[number];
export type Availability = (typeof AVAILABILITIES)[number];

export const STATUS_LABELS: Record<DriverStatus, string> = {
  active: "Active",
  inactive: "Inactive",
  suspended: "Suspended",
};
export const AVAILABILITY_LABELS: Record<Availability, string> = {
  available: "Available",
  on_trip: "On a trip",
  off_duty: "Off duty",
  unavailable: "Unavailable",
};

export type Driver = {
  id: string;
  user_id: string | null;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  licence_number: string;
  sensitive_visible: boolean;
  licence_class: string | null;
  licence_country_code: string | null;
  licence_expires_on: string | null;
  status: DriverStatus;
  availability: Availability;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  current_vehicle: { id: string; registration_number: string } | null;
};

export type DriverPayload = {
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  licence_number: string;
  licence_class: string | null;
  licence_country_code: string | null;
  licence_expires_on: string | null;
  status: DriverStatus;
  availability: Availability;
};

export type Assignment = {
  id: string;
  vehicle_id: string;
  registration_number: string;
  started_at: string;
  ended_at: string | null;
};

export type DriverFilters = {
  search: string;
  status: string;
  availability: string;
  licence: string;
  archived: boolean;
  sort: string;
  page: number;
};

export type DriverPage = { items: Driver[]; total: number; page: number; page_size: number };

export const PAGE_SIZE = 25;
export const DRIVERS_KEY = ["drivers"];

export function fetchDrivers(filters: DriverFilters) {
  const params = new URLSearchParams({
    sort: filters.sort,
    page: String(filters.page),
    page_size: String(PAGE_SIZE),
  });
  if (filters.search) params.set("search", filters.search);
  if (filters.status) params.set("status", filters.status);
  if (filters.availability) params.set("availability", filters.availability);
  if (filters.licence) params.set("licence", filters.licence);
  if (filters.archived) params.set("archived", "true");
  return api<DriverPage>(`/drivers?${params}`);
}

export const fetchDriver = (id: string) => api<Driver>(`/drivers/${id}`);
export const fetchAssignments = (id: string) => api<Assignment[]>(`/drivers/${id}/assignments`);
export const createDriver = (body: DriverPayload) =>
  api<Driver>("/drivers", { method: "POST", body });
export const updateDriver = (
  id: string,
  body: Partial<DriverPayload> & { expected_updated_at: string },
) => api<Driver>(`/drivers/${id}`, { method: "PATCH", body });
export const archiveDriver = (id: string) =>
  api<Driver>(`/drivers/${id}/archive`, { method: "POST" });
export const restoreDriver = (id: string) =>
  api<Driver>(`/drivers/${id}/restore`, { method: "POST" });
export const assignVehicle = (id: string, vehicle_id: string) =>
  api<Driver>(`/drivers/${id}/assign`, { method: "POST", body: { vehicle_id } });
export const unassignVehicle = (id: string) =>
  api<Driver>(`/drivers/${id}/unassign`, { method: "POST" });
export const linkDriverAccount = (id: string, userId: string | null) =>
  api<Driver>(`/drivers/${id}/account`, { method: "POST", body: { user_id: userId } });
