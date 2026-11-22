import type { FleetStatus } from "./types";

export const ROUTE_COLOURS: Record<FleetStatus, string> = {
  moving: "#10b981",
  idle: "#f59e0b",
  stale: "#d97706",
  offline: "#64748b",
};
