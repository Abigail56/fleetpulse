import type { FleetVehicleRow } from "@/features/tracking/api";

import type { FleetStatus, LatLng } from "../fleet-map/types";
import { STATUS_LABELS } from "../fleet-map/types";

export type LiveStatus = FleetStatus | "unknown" | "no_position";

export const LIVE_STATUS_LABELS: Record<LiveStatus, string> = {
  ...STATUS_LABELS,
  unknown: "Speed unknown",
  no_position: "No position yet",
};

// GPS speed jitters while parked, so very low readings count as stopped.
const MOVING_KPH = 3;

export type LiveVehicle = {
  id: string;
  registration: string;
  description: string;
  status: LiveStatus;
  position: LatLng | null;
  headingDegrees: number | null;
  speedKph: number | null;
  ignitionOn: boolean | null;
  signal: FleetVehicleRow["signal_status"];
  isSimulated: boolean;
  driverName: string | null;
  recordedAt: Date | null;
  secondsSinceUpdate: number | null;
};

const toNumber = (value: string | null) => (value === null ? null : Number(value));

/** Only ever worked out from what the vehicle reported, and age overrides everything else. */
export function deriveStatus(
  row: Pick<FleetVehicleRow, "recorded_at" | "speed_kph" | "ignition_on">,
  now: number,
  limits: { staleMinutes: number; offlineMinutes: number },
): LiveStatus {
  if (row.recorded_at === null) return "no_position";
  const ageMinutes = (now - new Date(row.recorded_at).getTime()) / 60_000;
  if (ageMinutes > limits.offlineMinutes) return "offline";
  if (ageMinutes > limits.staleMinutes) return "stale";
  const speed = toNumber(row.speed_kph);
  if (speed !== null) return speed >= MOVING_KPH ? "moving" : "idle";
  return row.ignition_on === false ? "idle" : "unknown";
}

export function toLiveVehicle(
  row: FleetVehicleRow,
  now: number,
  limits: { staleMinutes: number; offlineMinutes: number },
): LiveVehicle {
  const recordedAt = row.recorded_at === null ? null : new Date(row.recorded_at);
  return {
    id: row.id,
    registration: row.registration_number,
    description: `${row.make} ${row.model}`,
    status: deriveStatus(row, now, limits),
    position:
      row.latitude === null || row.longitude === null ? null : [row.latitude, row.longitude],
    headingDegrees: toNumber(row.heading_degrees),
    speedKph: toNumber(row.speed_kph),
    ignitionOn: row.ignition_on,
    signal: row.signal_status,
    isSimulated: row.is_simulated,
    driverName: row.driver_name,
    recordedAt,
    secondsSinceUpdate:
      recordedAt === null ? null : Math.max(0, Math.floor((now - recordedAt.getTime()) / 1000)),
  };
}

export function matchesSearch(vehicle: LiveVehicle, search: string) {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return [vehicle.registration, vehicle.description, vehicle.driverName ?? ""].some((value) =>
    value.toLowerCase().includes(needle),
  );
}
