import { api } from "@/lib/api/client";

export const TRIP_STATUSES = [
  "draft",
  "planned",
  "dispatched",
  "in_progress",
  "completed",
  "cancelled",
] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];

export const STATUS_LABELS: Record<TripStatus, string> = {
  draft: "Draft",
  planned: "Planned",
  dispatched: "Dispatched",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

export type Trip = {
  id: string;
  status: TripStatus;
  origin_name: string;
  destination_name: string;
  vehicle_id: string | null;
  vehicle_registration: string | null;
  driver_id: string | null;
  driver_name: string | null;
  planned_departure_at: string | null;
  estimated_arrival_at: string | null;
  actual_departure_at: string | null;
  actual_arrival_at: string | null;
  distance_km: string | null;
  distance_source: "gps" | "simulated" | "manual" | null;
  dispatch_notes: string | null;
  created_at: string;
  updated_at: string;
};

export type TripPayload = Partial<
  Pick<
    Trip,
    | "origin_name"
    | "destination_name"
    | "vehicle_id"
    | "driver_id"
    | "planned_departure_at"
    | "estimated_arrival_at"
    | "dispatch_notes"
  >
>;

export type TripFilters = {
  search: string;
  status: string;
  vehicle: string;
  driver: string;
  page: number;
};

export type TripPage = { items: Trip[]; total: number; page: number; page_size: number };
export type TripEvent = { action: string; occurred_at: string; actor_name: string | null };
export type TripRoute = {
  points: { recorded_at: string; latitude: number; longitude: number }[];
  is_simulated: boolean;
  is_limited: boolean;
};
export type TripOptions = {
  vehicles: { id: string; registration_number: string; make: string; model: string }[];
  drivers: { id: string; name: string }[];
};

export const TRIPS_KEY = ["trips"];
export const PAGE_SIZE = 25;

export function fetchTrips(filters: TripFilters, pageSize = PAGE_SIZE) {
  const params = new URLSearchParams({ page: String(filters.page), page_size: String(pageSize) });
  if (filters.search) params.set("search", filters.search);
  if (filters.status) params.set("status", filters.status);
  if (filters.vehicle) params.set("vehicle_id", filters.vehicle);
  if (filters.driver) params.set("driver_id", filters.driver);
  return api<TripPage>(`/trips?${params}`);
}
export const fetchTrip = (id: string) => api<Trip>(`/trips/${id}`);
export const fetchTripOptions = () => api<TripOptions>("/trips/options");
export const fetchTripEvents = (id: string) => api<TripEvent[]>(`/trips/${id}/events`);
export const fetchTripRoute = (id: string) => api<TripRoute>(`/trips/${id}/route`);
export const createTrip = (body: TripPayload) => api<Trip>("/trips", { method: "POST", body });
export const updateTrip = (id: string, body: TripPayload) =>
  api<Trip>(`/trips/${id}`, { method: "PATCH", body });
export const planTrip = (id: string) => api<Trip>(`/trips/${id}/plan`, { method: "POST" });
export const dispatchTrip = (id: string) => api<Trip>(`/trips/${id}/dispatch`, { method: "POST" });
export const cancelTrip = (id: string) => api<Trip>(`/trips/${id}/cancel`, { method: "POST" });
export const startTrip = (id: string, actualDepartureAt: string | null) =>
  api<Trip>(`/trips/${id}/start`, {
    method: "POST",
    body: actualDepartureAt ? { actual_departure_at: actualDepartureAt } : {},
  });
export const completeTrip = (
  id: string,
  body: { actual_arrival_at?: string; distance_km?: string },
) => api<Trip>(`/trips/${id}/complete`, { method: "POST", body });
