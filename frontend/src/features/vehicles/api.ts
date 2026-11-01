import { api } from "@/lib/api/client";

export const VEHICLE_STATUSES = ["active", "idle", "maintenance", "out_of_service"] as const;
export const VEHICLE_TYPES = [
  "car",
  "van",
  "pickup",
  "truck",
  "bus",
  "motorcycle",
  "heavy_equipment",
  "other",
] as const;
export const FUEL_TYPES = ["petrol", "diesel", "cng", "lpg", "electric", "hybrid", "other"] as const;
export const OWNERSHIP_TYPES = ["owned", "leased", "rented"] as const;

export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];
export type VehicleType = (typeof VEHICLE_TYPES)[number];
export type FuelType = (typeof FUEL_TYPES)[number];
export type OwnershipType = (typeof OWNERSHIP_TYPES)[number];

export const STATUS_LABELS: Record<VehicleStatus, string> = {
  active: "Active",
  idle: "Idle",
  maintenance: "In maintenance",
  out_of_service: "Out of service",
};
export const TYPE_LABELS: Record<VehicleType, string> = {
  car: "Car",
  van: "Van",
  pickup: "Pickup",
  truck: "Truck",
  bus: "Bus",
  motorcycle: "Motorcycle",
  heavy_equipment: "Heavy equipment",
  other: "Other",
};
export const FUEL_LABELS: Record<FuelType, string> = {
  petrol: "Petrol",
  diesel: "Diesel",
  cng: "CNG",
  lpg: "LPG",
  electric: "Electric",
  hybrid: "Hybrid",
  other: "Other",
};
export const OWNERSHIP_LABELS: Record<OwnershipType, string> = {
  owned: "Owned",
  leased: "Leased",
  rented: "Rented",
};

export type Vehicle = {
  id: string;
  registration_number: string;
  make: string;
  model: string;
  year: number | null;
  vehicle_type: VehicleType;
  vin: string | null;
  fuel_type: FuelType;
  odometer_km: string;
  ownership_type: OwnershipType;
  owner_name: string | null;
  status: VehicleStatus;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  current_driver?: { id: string; name: string } | null;
};

export type VehiclePayload = {
  registration_number: string;
  make: string;
  model: string;
  year: number | null;
  vehicle_type: VehicleType;
  vin: string | null;
  fuel_type: FuelType;
  odometer_km: number;
  ownership_type: OwnershipType;
  owner_name: string | null;
  status: VehicleStatus;
};

export type VehicleFilters = {
  search: string;
  status: string;
  vehicle_type: string;
  archived: boolean;
  sort: string;
  page: number;
};

export type VehiclePage = { items: Vehicle[]; total: number; page: number; page_size: number };

export const PAGE_SIZE = 25;
export const VEHICLES_KEY = ["vehicles"];

export function fetchVehicles(filters: VehicleFilters) {
  const params = new URLSearchParams({
    sort: filters.sort,
    page: String(filters.page),
    page_size: String(PAGE_SIZE),
  });
  if (filters.search) params.set("search", filters.search);
  if (filters.status) params.set("status", filters.status);
  if (filters.vehicle_type) params.set("vehicle_type", filters.vehicle_type);
  if (filters.archived) params.set("archived", "true");
  return api<VehiclePage>(`/vehicles?${params}`);
}

export const fetchVehicle = (id: string) => api<Vehicle>(`/vehicles/${id}`);
export const createVehicle = (body: VehiclePayload) =>
  api<Vehicle>("/vehicles", { method: "POST", body });
export const updateVehicle = (
  id: string,
  body: Partial<VehiclePayload> & { expected_updated_at: string },
) =>
  api<Vehicle>(`/vehicles/${id}`, { method: "PATCH", body });
export const archiveVehicle = (id: string) =>
  api<Vehicle>(`/vehicles/${id}/archive`, { method: "POST" });
export const restoreVehicle = (id: string) =>
  api<Vehicle>(`/vehicles/${id}/restore`, { method: "POST" });
