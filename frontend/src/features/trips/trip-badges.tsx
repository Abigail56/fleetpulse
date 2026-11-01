import { type Status, StatusBadge } from "@/components/ui/status-badge";
import { type DistanceUnit, formatDistance } from "@/lib/distance";

import { STATUS_LABELS, type Trip, type TripStatus } from "./api";

const STYLES: Record<TripStatus, Status> = {
  draft: "neutral",
  planned: "info",
  dispatched: "info",
  in_progress: "success",
  completed: "neutral",
  cancelled: "warning",
};

export function TripStatusBadge({ status }: { status: TripStatus }) {
  return <StatusBadge status={STYLES[status]}>{STATUS_LABELS[status]}</StatusBadge>;
}

const SOURCE_LABELS: Record<NonNullable<Trip["distance_source"]>, string> = {
  gps: "measured from GPS positions",
  simulated: "from simulated test data",
  manual: "entered by hand",
};

export function distanceLabel(trip: Trip, unit: DistanceUnit = "km") {
  if (trip.distance_km === null) {
    return trip.status === "completed"
      ? "Not available: there weren't enough GPS positions, and none was entered"
      : "Recorded when the trip is completed";
  }
  const source = trip.distance_source ? ` (${SOURCE_LABELS[trip.distance_source]})` : "";
  return `${formatDistance(Number(trip.distance_km), unit)}${source}`;
}
