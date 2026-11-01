"use client";

import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";

import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";

import { fetchVehicleLatest, TRACKING_KEY } from "./api";

const REFRESH_MS = 30_000;
const SIGNAL_LABELS = { good: "Good", weak: "Weak", lost: "Lost", unknown: "Not reported" };

/** Says plainly how old a position is, and whether it's simulated, wherever it's shown. */
export function PositionCard({ vehicleId }: { vehicleId: string }) {
  const latest = useQuery({
    queryKey: [...TRACKING_KEY, "latest", vehicleId],
    queryFn: () => fetchVehicleLatest(vehicleId),
    refetchInterval: REFRESH_MS,
  });
  const position = latest.data;

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">Last known position</h2>
        {position?.is_stale && <StatusBadge status="warning">Stale</StatusBadge>}
        {position?.is_simulated && <StatusBadge status="info">Simulated</StatusBadge>}
      </div>
      {latest.isPending && <div className="skeleton mt-3 h-16 w-full" />}
      {latest.isError && (
        <Alert variant="error" className="mt-3">
          {latest.error.message}
        </Alert>
      )}
      {latest.isSuccess && !position && (
        <p className="mt-1 text-sm opacity-75">No position has been received for this vehicle.</p>
      )}
      {position && (
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="font-medium">Reported</dt>
            <dd>{formatDistanceToNow(new Date(position.recorded_at), { addSuffix: true })}</dd>
          </div>
          <div>
            <dt className="font-medium">Coordinates</dt>
            <dd className="font-mono">
              {position.latitude.toFixed(5)}, {position.longitude.toFixed(5)}
            </dd>
          </div>
          <div>
            <dt className="font-medium">Speed</dt>
            <dd>{position.speed_kph === null ? "Not reported" : `${Number(position.speed_kph)} km/h`}</dd>
          </div>
          <div>
            <dt className="font-medium">Ignition</dt>
            <dd>
              {position.ignition_on === null ? "Not reported" : position.ignition_on ? "On" : "Off"}
            </dd>
          </div>
          <div>
            <dt className="font-medium">GPS signal</dt>
            <dd>{SIGNAL_LABELS[position.signal_status]}</dd>
          </div>
        </dl>
      )}
    </Card>
  );
}
