import { api } from "@/lib/api/client";

export const CATEGORIES = [
  "tolls",
  "parking",
  "insurance",
  "repairs",
  "tyres",
  "licensing",
  "fines",
  "cleaning",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];
export const CATEGORY_LABELS: Record<Category, string> = {
  tolls: "Tolls",
  parking: "Parking",
  insurance: "Insurance",
  repairs: "Repairs",
  tyres: "Tyres",
  licensing: "Licensing",
  fines: "Fines",
  cleaning: "Cleaning",
  other: "Other",
};
export const EXPENSE_STATUSES = ["submitted", "approved", "rejected"] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];
export const STATUS_LABELS: Record<ExpenseStatus, string> = {
  submitted: "Awaiting approval",
  approved: "Approved",
  rejected: "Rejected",
};
export type FuelUnit = "litres" | "kwh";
export const UNIT_LABELS: Record<FuelUnit, string> = { litres: "litres", kwh: "kWh" };

export type StoredFile = {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
};
export type FuelEntry = {
  id: string;
  vehicle_id: string;
  vehicle_registration: string;
  filled_at: string;
  quantity: string;
  unit: FuelUnit;
  unit_price: string;
  total_cost: string;
  currency: string;
  odometer_km: string | null;
  is_full_tank: boolean;
  station_name: string | null;
  notes: string | null;
  receipt: StoredFile | null;
  created_by_user_id: string | null;
  voided_at: string | null;
};
export type Expense = {
  id: string;
  vehicle_id: string;
  vehicle_registration: string;
  category: Category;
  amount: string;
  currency: string;
  incurred_on: string;
  vendor: string | null;
  description: string | null;
  receipt: StoredFile | null;
  status: ExpenseStatus;
  submitted_by_user_id: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  voided_at: string | null;
};
export type Paged<T> = { items: T[]; total: number; page: number; page_size: number };
export type CostOptions = {
  vehicles: { id: string; registration_number: string; make: string; model: string }[];
  default_currency: string;
};
export type CostSummary = {
  start: string;
  end: string;
  totals: {
    currency: string;
    fuel: string;
    maintenance: string;
    expenses: string;
    total: string;
  }[];
  expense_categories: { category: Category; currency: string; amount: string }[];
  awaiting_approval: number;
};
export type VehicleCosts = {
  start: string;
  end: string;
  distance_km: string | null;
  readings: number;
  costs: { currency: string; total: string; cost_per_km: string | null }[];
  consumption: { unit: FuelUnit; per_100_km: string; distance_km: string }[];
};
export type FuelPayload = {
  vehicle_id?: string;
  filled_at?: string;
  quantity?: string;
  unit?: FuelUnit;
  unit_price?: string;
  currency?: string;
  odometer_km?: string | null;
  is_full_tank?: boolean;
  station_name?: string | null;
  notes?: string | null;
  receipt_file_id?: string | null;
};
export type ExpensePayload = {
  vehicle_id?: string;
  category?: Category;
  amount?: string;
  currency?: string;
  incurred_on?: string;
  vendor?: string | null;
  description?: string | null;
  receipt_file_id?: string | null;
};

export const COSTS_KEY = ["costs"];
export const PAGE_SIZE = 25;

export const fetchOptions = () => api<CostOptions>("/costs/options");
export const fetchSummary = (start: string, end: string) => {
  const params = new URLSearchParams();
  if (start) params.set("start", start);
  if (end) params.set("end", end);
  return api<CostSummary>(`/costs/summary?${params}`);
};
export const fetchVehicleCosts = (vehicleId: string, start: string, end: string) => {
  const params = new URLSearchParams();
  if (start) params.set("start", start);
  if (end) params.set("end", end);
  return api<VehicleCosts>(`/costs/vehicles/${vehicleId}?${params}`);
};
export const fetchFuel = (page: number, vehicle = "") =>
  api<Paged<FuelEntry>>(
    `/costs/fuel?page=${page}${vehicle ? `&vehicle_id=${vehicle}` : ""}`,
  );
export const fetchFuelEntry = (id: string) => api<FuelEntry>(`/costs/fuel/${id}`);
export const createFuel = (body: FuelPayload) =>
  api<FuelEntry>("/costs/fuel", { method: "POST", body });
export const updateFuel = (id: string, body: FuelPayload) =>
  api<FuelEntry>(`/costs/fuel/${id}`, { method: "PATCH", body });
export const voidFuel = (id: string) => api<FuelEntry>(`/costs/fuel/${id}/void`, { method: "POST" });
export function fetchExpenses(filters: { status: string; category: string; page: number }) {
  const params = new URLSearchParams({ page: String(filters.page) });
  if (filters.status) params.set("status", filters.status);
  if (filters.category) params.set("category", filters.category);
  return api<Paged<Expense>>(`/costs/expenses?${params}`);
}
export const fetchExpense = (id: string) => api<Expense>(`/costs/expenses/${id}`);
export const createExpense = (body: ExpensePayload) =>
  api<Expense>("/costs/expenses", { method: "POST", body });
export const updateExpense = (id: string, body: ExpensePayload) =>
  api<Expense>(`/costs/expenses/${id}`, { method: "PATCH", body });
export const approveExpense = (id: string) =>
  api<Expense>(`/costs/expenses/${id}/approve`, { method: "POST", body: {} });
export const rejectExpense = (id: string, note: string) =>
  api<Expense>(`/costs/expenses/${id}/reject`, { method: "POST", body: { note } });
export const voidExpense = (id: string) =>
  api<Expense>(`/costs/expenses/${id}/void`, { method: "POST" });
export function uploadReceipt(file: File) {
  const body = new FormData();
  body.set("file", file);
  body.set("purpose", "receipt");
  return api<StoredFile>("/files", { method: "POST", body });
}
export const fetchFileLink = (id: string) =>
  api<{ url: string; expires_in_seconds: number }>(`/files/${id}/link`);
