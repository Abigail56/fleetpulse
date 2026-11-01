import { type Status, StatusBadge } from "@/components/ui/status-badge";

import { STATUS_LABELS, type Vehicle, type VehicleStatus } from "./api";

const TONES: Record<VehicleStatus, Status> = {
  active: "success",
  idle: "neutral",
  maintenance: "warning",
  out_of_service: "error",
};

export function VehicleStatusBadge({ vehicle }: { vehicle: Vehicle }) {
  if (vehicle.archived_at) return <StatusBadge status="neutral">Archived</StatusBadge>;
  return <StatusBadge status={TONES[vehicle.status]}>{STATUS_LABELS[vehicle.status]}</StatusBadge>;
}
