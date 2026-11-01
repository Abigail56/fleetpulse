"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowLeft } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Alert } from "@/components/ui/alert";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import type { CurrentMembership } from "@/features/organisation/api";
import { ApiError } from "@/lib/api/client";

import { MapBoundary } from "../fleet-map/map-boundary";
import {
  archiveGeofence,
  fetchGeofence,
  fetchGeofenceEvents,
  type Geofence,
  GEOFENCES_KEY,
} from "./api";
import { GeofenceForm } from "./geofence-form";

const NO_REFERENCE: [number, number][] = [];
const EVENT_PAGE_SIZE = 25;

const GeofenceMap = dynamic(() => import("./geofence-map"), {
  ssr: false,
  loading: () => (
    <div role="status" className="fleet-map flex h-full w-full items-center justify-center text-xs text-neutral-content/70">
      Loading map…
    </div>
  ),
});

function useGeofenceFromRoute() {
  const { id } = useParams<{ id: string }>();
  return useQuery({ queryKey: [...GEOFENCES_KEY, "detail", id], queryFn: () => fetchGeofence(id) });
}

function LoadState({ query }: { query: ReturnType<typeof useGeofenceFromRoute> }) {
  if (query.isPending) {
    return (
      <p role="status" className="text-sm opacity-75">
        Loading geofence…
      </p>
    );
  }
  const missing = query.error instanceof ApiError && query.error.status === 404;
  return (
    <div className="flex flex-col items-start gap-3">
      <h1 className="text-3xl font-bold tracking-tight">
        {missing ? "Geofence not found" : "Geofence"}
      </h1>
      <Alert variant="error">{missing ? "This geofence doesn't exist." : query.error?.message}</Alert>
      <ButtonLink href="/geofences" variant="outline">
        Back to geofences
      </ButtonLink>
    </div>
  );
}

function Events({ geofence }: { geofence: Geofence }) {
  const [page, setPage] = useState(1);
  const events = useQuery({
    queryKey: [...GEOFENCES_KEY, "events", geofence.id, page],
    queryFn: () => fetchGeofenceEvents(geofence.id, page),
    refetchInterval: 30_000,
  });
  const pages = Math.max(1, Math.ceil((events.data?.total ?? 0) / EVENT_PAGE_SIZE));
  return (
    <Card>
      <h2 className="text-lg font-semibold">Entry and exit history</h2>
      {events.isPending && <p className="mt-2 text-sm opacity-75">Loading history…</p>}
      {events.isError && <p className="mt-2 text-sm">The history couldn&apos;t be loaded.</p>}
      {events.data?.total === 0 && (
        <p className="mt-2 text-sm opacity-75">No vehicle has entered or left this area yet.</p>
      )}
      {events.data && events.data.total > 0 && (
        <ul aria-label="Entry and exit history" className="mt-3 divide-y divide-base-300 border-y border-base-300">
          {events.data.items.map((event) => (
            <li key={event.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
              <span>
                <Link href={`/vehicles/${event.vehicle_id}`} className="link font-mono">
                  {event.vehicle_registration}
                </Link>{" "}
                {event.event_type === "entry" ? "entered" : "left"}
                {event.is_simulated && " · Simulated"}
              </span>
              <span className="text-xs tabular-nums opacity-75">
                {format(new Date(event.occurred_at), "d MMM yyyy, HH:mm:ss")}
              </span>
            </li>
          ))}
        </ul>
      )}
      {pages > 1 && (
        <div className="mt-3 flex items-center gap-2 text-sm">
          <Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          Page {page} of {pages}
          <Button variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      )}
    </Card>
  );
}

export function GeofenceDetail({ membership }: { membership: CurrentMembership }) {
  const query = useGeofenceFromRoute();
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const geofence = query.data;
  const archive = useMutation({
    mutationFn: (id: string) => archiveGeofence(id),
    onSuccess: async () => {
      setConfirm(false);
      toast.success("Geofence archived.");
      await queryClient.invalidateQueries({ queryKey: GEOFENCES_KEY });
    },
    onError: (error) => {
      setConfirm(false);
      toast.error(error.message);
    },
  });
  if (!geofence) return <LoadState query={query} />;

  const canManage = membership.permissions.includes("geofences.manage");
  const archived = geofence.archived_at !== null;
  const alerts = [
    geofence.is_restricted && "Any entry raises a critical alert",
    !geofence.is_restricted && geofence.alert_on_entry && "On entry",
    geofence.alert_on_exit && "On exit",
  ].filter(Boolean);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Link href="/geofences" className="link inline-flex items-center gap-1 text-sm">
        <ArrowLeft aria-hidden className="size-4" />
        Geofences
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-bold tracking-tight">{geofence.name}</h1>
        {geofence.is_restricted && <StatusBadge status="error">Restricted</StatusBadge>}
        {archived && <StatusBadge status="neutral">Archived</StatusBadge>}
      </div>
      {canManage && !archived && (
        <div className="flex flex-wrap gap-3">
          <ButtonLink href={`/geofences/${geofence.id}/edit`} variant="outline">
            Edit
          </ButtonLink>
          <Button variant="ghost" onClick={() => setConfirm(true)}>
            Archive
          </Button>
        </div>
      )}
      <div className="isolate h-80 overflow-hidden rounded-box">
        <MapBoundary
          fallback={
            <div className="fleet-map flex h-full w-full items-center justify-center p-6 text-center text-sm text-neutral-content">
              This device can&apos;t display the map.
            </div>
          }
        >
          <GeofenceMap boundary={geofence.boundary} reference={NO_REFERENCE} />
        </MapBoundary>
      </div>
      <Card>
        <h2 className="text-lg font-semibold">Details</h2>
        <dl className="mt-3 divide-y divide-base-300 border-y border-base-300 text-sm">
          <div className="grid gap-1 py-3 sm:grid-cols-[1fr_2fr]">
            <dt className="font-medium">Shape</dt>
            <dd>
              {geofence.kind === "circle"
                ? `Circle, ${geofence.radius_m} m radius`
                : `Polygon, ${geofence.boundary.length - 1} corners`}
            </dd>
          </div>
          <div className="grid gap-1 py-3 sm:grid-cols-[1fr_2fr]">
            <dt className="font-medium">Vehicles inside now</dt>
            <dd>{geofence.vehicles_inside}</dd>
          </div>
          <div className="grid gap-1 py-3 sm:grid-cols-[1fr_2fr]">
            <dt className="font-medium">Alerts</dt>
            <dd>{alerts.length > 0 ? alerts.join(", ") : "None: events are still recorded"}</dd>
          </div>
        </dl>
      </Card>
      <Events geofence={geofence} />
      <ConfirmDialog
        open={confirm}
        title="Archive this geofence?"
        confirmLabel="Archive"
        busy={archive.isPending}
        onCancel={() => setConfirm(false)}
        onConfirm={() => archive.mutate(geofence.id)}
      >
        It stops recording entries and exits. Its history is kept.
      </ConfirmDialog>
    </div>
  );
}

export function EditGeofence() {
  const query = useGeofenceFromRoute();
  const geofence = query.data;
  if (!geofence) return <LoadState query={query} />;
  if (geofence.archived_at) {
    return (
      <div className="flex flex-col items-start gap-3">
        <h1 className="text-3xl font-bold tracking-tight">Edit geofence</h1>
        <Alert variant="info">An archived geofence can&apos;t be changed.</Alert>
      </div>
    );
  }
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <h1 className="text-3xl font-bold tracking-tight">Edit geofence</h1>
      <GeofenceForm geofence={geofence} />
    </div>
  );
}
