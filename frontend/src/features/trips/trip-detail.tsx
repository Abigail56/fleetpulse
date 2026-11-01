"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowLeft } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Alert } from "@/components/ui/alert";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, TextInput } from "@/components/ui/field";
import type { CurrentMembership } from "@/features/organisation/api";
import { ApiError } from "@/lib/api/client";
import { toKm } from "@/lib/distance";

import { MapBoundary } from "../fleet-map/map-boundary";
import type { LatLng } from "../fleet-map/types";
import {
  cancelTrip,
  completeTrip,
  dispatchTrip,
  fetchTrip,
  fetchTripEvents,
  fetchTripRoute,
  planTrip,
  startTrip,
  type Trip,
  TRIPS_KEY,
} from "./api";
import { fromLocalInput } from "./schema";
import { distanceLabel, TripStatusBadge } from "./trip-badges";
import { TripForm } from "./trip-form";

const LIVE_ROUTE_REFRESH_MS = 30_000;
const NO_VEHICLES: never[] = [];

const EVENT_LABELS: Record<string, string> = {
  "trip.created": "Created",
  "trip.updated": "Edited",
  "trip.planned": "Planned",
  "trip.dispatched": "Dispatched",
  "trip.started": "Departed",
  "trip.completed": "Completed",
  "trip.cancelled": "Cancelled",
};

const LiveMapCanvas = dynamic(() => import("../live-map/live-map-canvas"), {
  ssr: false,
  loading: () => (
    <div role="status" className="fleet-map flex h-full w-full items-center justify-center text-xs text-neutral-content/70">
      Loading map…
    </div>
  ),
});

const when = (iso: string | null) =>
  iso ? format(new Date(iso), "d MMM yyyy, HH:mm") : "Not recorded";

function useTripFromRoute() {
  const { id } = useParams<{ id: string }>();
  return useQuery({ queryKey: [...TRIPS_KEY, "detail", id], queryFn: () => fetchTrip(id) });
}

function LoadState({ query }: { query: ReturnType<typeof useTripFromRoute> }) {
  if (query.isPending) {
    return (
      <p role="status" className="text-sm opacity-75">
        Loading trip…
      </p>
    );
  }
  const missing = query.error instanceof ApiError && query.error.status === 404;
  return (
    <div className="flex flex-col items-start gap-3">
      <h1 className="text-3xl font-bold tracking-tight">{missing ? "Trip not found" : "Trip"}</h1>
      <Alert variant="error">
        {missing ? "This trip doesn't exist, or you don't have access to it." : query.error?.message}
      </Alert>
      <ButtonLink href="/trips" variant="outline">
        Back to trips
      </ButtonLink>
    </div>
  );
}

function Actions({ trip, membership }: { trip: Trip; membership: CurrentMembership }) {
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<"dispatch" | "start" | "complete" | "cancel" | null>(null);
  const [time, setTime] = useState("");
  const [distance, setDistance] = useState("");
  const canManage = membership.permissions.includes("trips.manage");
  const unit = membership.organisation.distance_unit;

  const change = useMutation({
    mutationFn: ({ action }: { action: () => Promise<Trip>; message: string }) => action(),
    onSuccess: async (_trip, { message }) => {
      setDialog(null);
      setTime("");
      setDistance("");
      toast.success(message);
      await queryClient.invalidateQueries({ queryKey: TRIPS_KEY });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      await queryClient.invalidateQueries({ queryKey: ["drivers"] });
    },
    onError: (error) => {
      setDialog(null);
      toast.error(error.message);
    },
  });
  const closed = trip.status === "completed" || trip.status === "cancelled";
  if (closed) return null;

  return (
    <div className="flex flex-wrap gap-3">
      {canManage && trip.status === "draft" && (
        <Button
          disabled={change.isPending}
          onClick={() =>
            change.mutate({ action: () => planTrip(trip.id), message: "Trip planned." })
          }
        >
          Mark as planned
        </Button>
      )}
      {canManage && trip.status === "planned" && (
        <Button onClick={() => setDialog("dispatch")}>Dispatch</Button>
      )}
      {trip.status === "dispatched" && <Button onClick={() => setDialog("start")}>Start trip</Button>}
      {trip.status === "in_progress" && (
        <Button onClick={() => setDialog("complete")}>Complete trip</Button>
      )}
      {canManage && (
        <>
          <ButtonLink href={`/trips/${trip.id}/edit`} variant="outline">
            Edit
          </ButtonLink>
          <Button variant="ghost" onClick={() => setDialog("cancel")}>
            Cancel trip
          </Button>
        </>
      )}
      <ConfirmDialog
        open={dialog === "dispatch"}
        title="Dispatch this trip?"
        confirmLabel="Dispatch"
        busy={change.isPending}
        onCancel={() => setDialog(null)}
        onConfirm={() =>
          change.mutate({ action: () => dispatchTrip(trip.id), message: "Trip dispatched." })
        }
      >
        {trip.vehicle_registration ?? "No vehicle"} with {trip.driver_name ?? "no driver"}. The
        route, vehicle and driver can&apos;t change after this.
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === "start"}
        title="Start this trip?"
        confirmLabel="Start trip"
        busy={change.isPending}
        onCancel={() => setDialog(null)}
        onConfirm={() =>
          change.mutate({
            action: () => startTrip(trip.id, fromLocalInput(time)),
            message: "Trip started.",
          })
        }
      >
        <Field id="departed" label="Departure time" hint="Leave blank to use the current time.">
          {(describedBy) => (
            <TextInput
              id="departed"
              type="datetime-local"
              value={time}
              aria-describedby={describedBy}
              onChange={(event) => setTime(event.target.value)}
            />
          )}
        </Field>
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === "complete"}
        title="Complete this trip?"
        confirmLabel="Complete trip"
        busy={change.isPending}
        onCancel={() => setDialog(null)}
        onConfirm={() =>
          change.mutate({
            action: () =>
              completeTrip(trip.id, {
                ...(time ? { actual_arrival_at: fromLocalInput(time)! } : {}),
                ...(distance ? { distance_km: toKm(Number(distance), unit).toFixed(2) } : {}),
              }),
            message: "Trip completed.",
          })
        }
      >
        <div className="flex flex-col gap-3">
          <Field id="arrived" label="Arrival time" hint="Leave blank to use the current time.">
            {(describedBy) => (
              <TextInput
                id="arrived"
                type="datetime-local"
                value={time}
                aria-describedby={describedBy}
                onChange={(event) => setTime(event.target.value)}
              />
            )}
          </Field>
          <Field
            id="distance"
            label={`Distance in ${unit}`}
            hint="Leave blank to measure it from the vehicle's GPS positions."
          >
            {(describedBy) => (
              <TextInput
                id="distance"
                type="number"
                min="0"
                step="0.01"
                value={distance}
                aria-describedby={describedBy}
                onChange={(event) => setDistance(event.target.value)}
              />
            )}
          </Field>
        </div>
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === "cancel"}
        title="Cancel this trip?"
        confirmLabel="Cancel trip"
        busy={change.isPending}
        onCancel={() => setDialog(null)}
        onConfirm={() =>
          change.mutate({ action: () => cancelTrip(trip.id), message: "Trip cancelled." })
        }
      >
        This can&apos;t be undone. The trip stays in the history.
      </ConfirmDialog>
    </div>
  );
}

function RouteCard({ trip }: { trip: Trip }) {
  const route = useQuery({
    queryKey: [...TRIPS_KEY, "route", trip.id, trip.status],
    queryFn: () => fetchTripRoute(trip.id),
    refetchInterval: trip.status === "in_progress" ? LIVE_ROUTE_REFRESH_MS : false,
  });
  const points = useMemo<LatLng[]>(
    () => route.data?.points.map((point) => [point.latitude, point.longitude]) ?? [],
    [route.data],
  );

  return (
    <Card>
      <h2 className="text-lg font-semibold">Route</h2>
      {route.isPending && <p className="mt-2 text-sm opacity-75">Loading route…</p>}
      {route.isError && <p className="mt-2 text-sm">The route couldn&apos;t be loaded.</p>}
      {route.data && points.length < 2 && (
        <p className="mt-2 text-sm opacity-75">
          Not enough GPS positions have been received during this trip to draw a route.
        </p>
      )}
      {route.data && points.length >= 2 && (
        <>
          <div className="isolate mt-3 h-80 overflow-hidden rounded-box">
            <MapBoundary
              fallback={
                <div className="fleet-map flex h-full w-full items-center justify-center p-6 text-center text-sm text-neutral-content">
                  This device can&apos;t display the map.
                </div>
              }
            >
              <LiveMapCanvas
                vehicles={NO_VEHICLES}
                selected={null}
                route={points}
                focusRequest={0}
                fitRequest={0}
                onSelect={() => {}}
              />
            </MapBoundary>
          </div>
          <p className="mt-2 text-xs opacity-75">
            {route.data.is_limited ? `The newest ${points.length}` : points.length} reported
            positions, joined by straight lines.
            {route.data.is_simulated && " Includes simulated data."}
          </p>
        </>
      )}
    </Card>
  );
}

function Timeline({ tripId }: { tripId: string }) {
  const events = useQuery({
    queryKey: [...TRIPS_KEY, "events", tripId],
    queryFn: () => fetchTripEvents(tripId),
  });
  return (
    <Card>
      <h2 className="text-lg font-semibold">History</h2>
      {events.isPending && <p className="mt-2 text-sm opacity-75">Loading history…</p>}
      {events.isError && <p className="mt-2 text-sm">The history couldn&apos;t be loaded.</p>}
      {events.data && (
        <ol className="mt-3 flex flex-col gap-2 text-sm">
          {events.data.map((event, index) => (
            <li key={index} className="flex flex-wrap justify-between gap-x-3">
              <span>
                {EVENT_LABELS[event.action] ?? event.action}
                {event.actor_name && <span className="opacity-75"> by {event.actor_name}</span>}
              </span>
              <span className="text-xs tabular-nums opacity-75">{when(event.occurred_at)}</span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

export function TripDetail({ membership }: { membership: CurrentMembership }) {
  const query = useTripFromRoute();
  const [now] = useState(() => Date.now());
  const trip = query.data;
  if (!trip) return <LoadState query={query} />;

  const late =
    trip.status === "in_progress" &&
    trip.estimated_arrival_at !== null &&
    new Date(trip.estimated_arrival_at).getTime() < now;
  const unit = membership.organisation.distance_unit;
  const rows: [string, React.ReactNode][] = [
    ["Vehicle", trip.vehicle_registration ?? "Not assigned"],
    ["Driver", trip.driver_name ?? "Not assigned"],
    ["Planned departure", when(trip.planned_departure_at)],
    ["Estimated arrival", when(trip.estimated_arrival_at)],
    ["Actual departure", when(trip.actual_departure_at)],
    ["Actual arrival", when(trip.actual_arrival_at)],
    ["Distance", distanceLabel(trip, unit)],
    ["Dispatch notes", trip.dispatch_notes ?? "None"],
  ];

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Link href="/trips" className="link inline-flex items-center gap-1 text-sm">
        <ArrowLeft aria-hidden className="size-4" />
        Trips
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-bold tracking-tight">
          {trip.origin_name} → {trip.destination_name}
        </h1>
        <TripStatusBadge status={trip.status} />
      </div>
      {late && <Alert variant="error">This trip has passed its estimated arrival time.</Alert>}
      <Actions trip={trip} membership={membership} />
      <Card>
        <h2 className="text-lg font-semibold">Details</h2>
        <dl className="mt-3 divide-y divide-base-300 border-y border-base-300">
          {rows.map(([label, value]) => (
            <div key={label} className="grid gap-1 py-3 sm:grid-cols-[1fr_2fr]">
              <dt className="text-sm font-medium">{label}</dt>
              <dd className="text-sm break-words whitespace-pre-wrap">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
      {trip.actual_departure_at && <RouteCard trip={trip} />}
      <Timeline tripId={trip.id} />
    </div>
  );
}

export function EditTrip() {
  const query = useTripFromRoute();
  const trip = query.data;
  if (!trip) return <LoadState query={query} />;
  if (trip.status === "completed" || trip.status === "cancelled") {
    return (
      <div className="flex flex-col items-start gap-3">
        <h1 className="text-3xl font-bold tracking-tight">Edit trip</h1>
        <Alert variant="info">A completed or cancelled trip can&apos;t be changed.</Alert>
        <ButtonLink href={`/trips/${trip.id}`} variant="outline">
          Back to trip
        </ButtonLink>
      </div>
    );
  }
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <h1 className="text-3xl font-bold tracking-tight">Edit trip</h1>
      <TripForm trip={trip} />
    </div>
  );
}
