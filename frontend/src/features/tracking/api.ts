import { api } from "@/lib/api/client";

export type Integration = {
  id: string;
  name: string;
  provider: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
};
export type Device = {
  id: string;
  provider: string;
  external_device_id: string;
  vehicle_id: string | null;
  registration_number: string | null;
  status: "active" | "inactive";
  is_simulated: boolean;
  last_seen_at: string | null;
};
export type LatestPosition = {
  vehicle_id: string;
  recorded_at: string;
  received_at: string;
  latitude: number;
  longitude: number;
  speed_kph: string | null;
  heading_degrees: string | null;
  ignition_on: boolean | null;
  signal_status: "good" | "weak" | "lost" | "unknown";
  is_simulated: boolean;
  is_stale: boolean;
};
export type TrackingConfig = {
  simulator_enabled: boolean;
  stale_minutes: number;
  offline_minutes: number;
};
export type FleetVehicleRow = {
  id: string;
  registration_number: string;
  make: string;
  model: string;
  vehicle_status: string;
  recorded_at: string | null;
  latitude: number | null;
  longitude: number | null;
  speed_kph: string | null;
  heading_degrees: string | null;
  ignition_on: boolean | null;
  signal_status: LatestPosition["signal_status"] | null;
  is_simulated: boolean;
  driver_name: string | null;
};
export type NewDevice = {
  external_device_id?: string;
  vehicle_id: string | null;
  simulated: boolean;
  start_latitude?: number;
  start_longitude?: number;
};

export const TRACKING_KEY = ["tracking"];

export const fetchConfig = () => api<TrackingConfig>("/tracking/config");
export const fetchIntegrations = () => api<Integration[]>("/tracking/integrations");
export const createIntegration = (name: string) =>
  api<Integration & { key: string }>("/tracking/integrations", { method: "POST", body: { name } });
export const revokeIntegration = (id: string) =>
  api(`/tracking/integrations/${id}`, { method: "DELETE" });
export const fetchDevices = () => api<Device[]>("/tracking/devices");
export const createDevice = (body: NewDevice) =>
  api<Device>("/tracking/devices", { method: "POST", body });
export const updateDevice = (
  id: string,
  body: { vehicle_id?: string | null; status?: Device["status"] },
) => api<Device>(`/tracking/devices/${id}`, { method: "PATCH", body });
export const fetchFleet = () => api<FleetVehicleRow[]>("/tracking/fleet");
export const fetchHistory = (vehicleId: string, start: Date, end: Date, limit: number) => {
  const query = new URLSearchParams({
    start: start.toISOString(),
    end: end.toISOString(),
    limit: String(limit),
  });
  return api<LatestPosition[]>(`/tracking/vehicles/${vehicleId}/history?${query}`);
};
export const fetchVehicleLatest = (vehicleId: string) =>
  api<LatestPosition | null>(`/tracking/vehicles/${vehicleId}/latest`);
