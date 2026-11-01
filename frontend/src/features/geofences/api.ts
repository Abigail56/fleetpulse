import { api } from "@/lib/api/client";

export type Geofence = {
  id: string;
  name: string;
  kind: "circle" | "polygon";
  /** Latitude and longitude pairs, for circles as well as polygons. */
  boundary: [number, number][];
  center_latitude: number | null;
  center_longitude: number | null;
  radius_m: number | null;
  is_restricted: boolean;
  alert_on_entry: boolean;
  alert_on_exit: boolean;
  vehicles_inside: number;
  archived_at: string | null;
  created_at: string;
};

export type GeofencePayload = {
  name: string;
  kind: Geofence["kind"];
  center_latitude?: number;
  center_longitude?: number;
  radius_m?: number;
  boundary?: [number, number][];
  is_restricted: boolean;
  alert_on_entry: boolean;
  alert_on_exit: boolean;
};

export type GeofenceEvent = {
  id: string;
  vehicle_id: string;
  vehicle_registration: string;
  event_type: "entry" | "exit";
  occurred_at: string;
  latitude: number;
  longitude: number;
  is_simulated: boolean;
};

export type GeofenceEventPage = {
  items: GeofenceEvent[];
  total: number;
  page: number;
  page_size: number;
};

export const GEOFENCES_KEY = ["geofences"];

export const fetchGeofences = (archived = false) =>
  api<Geofence[]>(`/geofences${archived ? "?archived=true" : ""}`);
export const fetchGeofence = (id: string) => api<Geofence>(`/geofences/${id}`);
export const fetchGeofenceEvents = (id: string, page: number) =>
  api<GeofenceEventPage>(`/geofences/${id}/events?page=${page}`);
export const createGeofence = (body: GeofencePayload) =>
  api<Geofence>("/geofences", { method: "POST", body });
export const updateGeofence = (id: string, body: Partial<GeofencePayload>) =>
  api<Geofence>(`/geofences/${id}`, { method: "PATCH", body });
export const archiveGeofence = (id: string) =>
  api<Geofence>(`/geofences/${id}/archive`, { method: "POST" });
