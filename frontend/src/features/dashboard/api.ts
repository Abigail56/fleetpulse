import { api } from "@/lib/api/client";

export type DashboardSummary = {
  vehicles: {
    total: number;
    active: number;
    idle: number;
    maintenance: number;
    out_of_service: number;
    utilisation_percent: number | null;
  } | null;
  drivers: {
    total: number;
    available: number;
    on_trip: number;
    off_duty: number;
    unavailable: number;
    licences_expiring_soon: number;
    licences_expired: number;
  } | null;
  trips: { in_progress: number; scheduled: number } | null;
};

export const fetchDashboard = () => api<DashboardSummary>("/dashboard");
