"use client";

import { useQuery } from "@tanstack/react-query";
import { format, subHours } from "date-fns";
import { MapPinOff, Truck, X } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button, ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { type Status, StatusBadge } from "@/components/ui/status-badge";
import { fetchGeofences, GEOFENCES_KEY } from "@/features/geofences/api";
import { fetchHistory, TRACKING_KEY } from "@/features/tracking/api";
import { cn } from "@/lib/cn";
import { useUrlFilters } from "@/lib/use-url-filters";

import { formatAge } from "../fleet-map/demo-fleet";
import { MapBoundary } from "../fleet-map/map-boundary";
import type { LatLng } from "../fleet-map/types";
import {
  LIVE_STATUS_LABELS,
  type LiveStatus,
  type LiveVehicle,
  matchesSearch,
  toLiveVehicle,
} from "./fleet-status";
import { POLL_MS, type StreamState, useLiveFleet } from "./use-live-fleet";

const TICK_MS = 1000;
const ROUTE_REFRESH_MS = 60_000;
const ROUTE_POINT_LIMIT = 5000;
// Rendering thousands of rows every second would slow the page; the search reaches the rest.
const MAX_LISTED = 200;
const STATUSES = Object.keys(LIVE_STATUS_LABELS) as LiveStatus[];
const ROUTE_PERIODS = [
  { hours: 1, label: "Last hour" },
  { hours: 6, label: "Last 6 hours" },
  { hours: 24, label: "Last 24 hours" },
  { hours: 168, label: "Last 7 days" },
];
const NO_ROUTE: LatLng[] = [];

const STREAM_DISPLAY: Record<StreamState, { status: Status; label: string }> = {
  connecting: { status: "neutral", label: "Connecting…" },
  live: { status: "success", label: "Live" },
  polling: { status: "warning", label: `Live updates paused · refreshing every ${POLL_MS / 1000} seconds` },
};

function MapLoading() {
  return (
    <div role="status" className="fleet-map flex h-full w-full items-center justify-center text-xs text-neutral-content/70">
      Loading map…
    </div>
  );
}

const LiveMapCanvas = dynamic(() => import("./live-map-canvas"), {
  ssr: false,
  loading: MapLoading,
});

type Filters = { search: string; status: LiveStatus | "" };

function readFilters(params: URLSearchParams): Filters {
  const status = params.get("status") as LiveStatus | null;
  return {
    search: params.get("q") ?? "",
    status: status && STATUSES.includes(status) ? status : "",
  };
}

function filterQuery({ search, status }: Filters) {
  const params = new URLSearchParams();
  if (search) params.set("q", search);
  if (status) params.set("status", status);
  return params.toString();
}

function Dot({ status }: { status: LiveStatus }) {
  return <span aria-hidden className={`fleet-dot fleet-dot--${status}`} />;
}

function VehicleRow({
  vehicle,
  selected,
  onSelect,
}: {
  vehicle: LiveVehicle;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className={cn(
          "block w-full px-3 py-2.5 text-left transition-colors hover:bg-base-200",
          selected && "bg-base-200",
        )}
      >
        <span className="flex items-center justify-between gap-2">
          <span className="font-mono text-sm font-medium">{vehicle.registration}</span>
          <span className="inline-flex items-center gap-1.5 text-xs font-medium">
            <Dot status={vehicle.status} />
            {LIVE_STATUS_LABELS[vehicle.status]}
          </span>
        </span>
        <span className="mt-0.5 flex justify-between gap-2 text-xs opacity-75">
          <span>
            {vehicle.description}
            {vehicle.isSimulated && " · Simulated"}
          </span>
          {vehicle.secondsSinceUpdate !== null && (
            <span className="shrink-0 tabular-nums">{formatAge(vehicle.secondsSinceUpdate)}</span>
          )}
        </span>
      </button>
    </li>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="opacity-75">{label}</dt>
      <dd className="text-right tabular-nums">{children}</dd>
    </div>
  );
}

const yesNo = (value: boolean | null, yes: string, no: string) =>
  value === null ? "Not reported" : value ? yes : no;

function VehicleDetails({
  vehicle,
  canViewDrivers,
  onClose,
  onRoute,
}: {
  vehicle: LiveVehicle;
  canViewDrivers: boolean;
  onClose: () => void;
  onRoute: (route: LatLng[]) => void;
}) {
  const [hours, setHours] = useState(6);
  const history = useQuery({
    queryKey: [...TRACKING_KEY, "route", vehicle.id, hours],
    enabled: vehicle.position !== null,
    refetchInterval: ROUTE_REFRESH_MS,
    queryFn: () => {
      const now = new Date();
      return fetchHistory(vehicle.id, subHours(now, hours), now, ROUTE_POINT_LIMIT);
    },
  });
  const points = history.data;

  useEffect(() => {
    onRoute(points?.map((point) => [point.latitude, point.longitude]) ?? NO_ROUTE);
    return () => onRoute(NO_ROUTE);
  }, [points, onRoute]);

  const isOld = vehicle.status === "stale" || vehicle.status === "offline";
  const speed =
    vehicle.speedKph === null
      ? "Not reported"
      : `${vehicle.speedKph} km/h${isOld ? " when last reported" : ""}`;

  return (
    <section aria-label={`${vehicle.registration} details`} className="border-b border-base-300 p-4 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-mono font-semibold">{vehicle.registration}</h2>
          <p className="text-xs opacity-75">{vehicle.description}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close details" className="btn btn-ghost btn-xs btn-square">
          <X aria-hidden className="size-4" />
        </button>
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-2 text-xs font-medium">
        <span className="inline-flex items-center gap-1.5">
          <Dot status={vehicle.status} />
          {LIVE_STATUS_LABELS[vehicle.status]}
        </span>
        {vehicle.isSimulated && <StatusBadge status="info">Simulated</StatusBadge>}
      </p>
      {isOld && vehicle.secondsSinceUpdate !== null && (
        <p className="mt-2 text-xs">
          This position is {formatAge(vehicle.secondsSinceUpdate)}. The vehicle may have moved since.
        </p>
      )}
      {vehicle.recordedAt === null ? (
        <p className="mt-2 text-xs">This vehicle hasn&apos;t reported a position.</p>
      ) : (
        <dl className="mt-3 space-y-1 text-xs">
          <Detail label="Last update">
            {format(vehicle.recordedAt, "d MMM yyyy, HH:mm:ss")}
          </Detail>
          <Detail label="Speed">{speed}</Detail>
          <Detail label="Heading">
            {vehicle.headingDegrees === null ? "Not reported" : `${vehicle.headingDegrees}°`}
          </Detail>
          <Detail label="Ignition">{yesNo(vehicle.ignitionOn, "On", "Off")}</Detail>
          <Detail label="GPS signal">
            {vehicle.signal === null || vehicle.signal === "unknown" ? "Not reported" : vehicle.signal[0].toUpperCase() + vehicle.signal.slice(1)}
          </Detail>
          {vehicle.position && (
            <Detail label="Location">
              {vehicle.position[0].toFixed(5)}, {vehicle.position[1].toFixed(5)}
            </Detail>
          )}
          {canViewDrivers && <Detail label="Driver">{vehicle.driverName ?? "Not assigned"}</Detail>}
        </dl>
      )}
      {vehicle.position && (
        <div className="mt-3 border-t border-base-300 pt-3">
          <label className="flex items-center justify-between gap-2 text-xs font-medium">
            Route
            <select
              className="select select-xs w-auto"
              value={hours}
              onChange={(event) => setHours(Number(event.target.value))}
            >
              {ROUTE_PERIODS.map((period) => (
                <option key={period.hours} value={period.hours}>
                  {period.label}
                </option>
              ))}
            </select>
          </label>
          <p role="status" className="mt-1.5 text-xs opacity-75">
            {history.isPending && "Loading route…"}
            {history.isError && "The route couldn't be loaded."}
            {points?.length === 0 && "No positions in this period."}
            {points && points.length > 0 && (
              <>
                {points.length === ROUTE_POINT_LIMIT
                  ? `Showing the newest ${ROUTE_POINT_LIMIT} positions`
                  : `${points.length} ${points.length === 1 ? "position" : "positions"}`}
                , joined by straight lines.
                {points.some((point) => point.is_simulated) && " Includes simulated data."}
              </>
            )}
          </p>
        </div>
      )}
      <Link href={`/vehicles/${vehicle.id}`} className="link mt-3 inline-block text-xs">
        Open vehicle
      </Link>
    </section>
  );
}

export function LiveMap({
  canManage,
  canViewDrivers,
  canViewGeofences = false,
}: {
  canManage: boolean;
  canViewDrivers: boolean;
  canViewGeofences?: boolean;
}) {
  const { config, fleet, stream } = useLiveFleet();
  const fences = useQuery({
    queryKey: [...GEOFENCES_KEY, "list", false],
    queryFn: () => fetchGeofences(),
    enabled: canViewGeofences,
  });
  const mapFences = useMemo(
    () =>
      (fences.data ?? []).map((fence) => ({
        id: fence.id,
        name: fence.name,
        boundary: fence.boundary,
        isRestricted: fence.is_restricted,
      })),
    [fences.data],
  );
  const [filters, commitFilters] = useUrlFilters(readFilters);
  const [now, setNow] = useState(() => Date.now());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [route, setRoute] = useState<LatLng[]>(NO_ROUTE);
  const [focusRequest, setFocusRequest] = useState(0);
  const [fitRequest, setFitRequest] = useState(0);

  // Ages keep counting while the page is open, so a silent vehicle goes stale on its own.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(tick);
  }, []);

  const limits = config.data && {
    staleMinutes: config.data.stale_minutes,
    offlineMinutes: config.data.offline_minutes,
  };
  const vehicles = useMemo(
    () => (fleet.data && limits ? fleet.data.map((row) => toLiveVehicle(row, now, limits)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- limits is rebuilt from config.data
    [fleet.data, config.data, now],
  );
  const searched = vehicles.filter((vehicle) => matchesSearch(vehicle, filters.search));
  const shown = searched.filter((vehicle) => !filters.status || vehicle.status === filters.status);
  const selected = vehicles.find((vehicle) => vehicle.id === selectedId) ?? null;
  const positioned = vehicles.filter((vehicle) => vehicle.position).length;
  const simulated = vehicles.filter((vehicle) => vehicle.isSimulated).length;

  function setFilters(next: Filters) {
    commitFilters(next, filterQuery(next));
  }

  const display = STREAM_DISPLAY[stream];
  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-3xl font-bold tracking-tight">Live map</h1>
      <span role="status">
        <StatusBadge status={display.status}>{display.label}</StatusBadge>
      </span>
    </div>
  );

  if (fleet.isPending || config.isPending) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <p role="status" className="text-sm opacity-75">Loading your fleet…</p>
      </div>
    );
  }

  const loadError = !fleet.data ? fleet.error : config.error;
  if (loadError || !limits) {
    return (
      <div className="flex flex-col items-start gap-3">
        {header}
        <Alert variant="error">{loadError?.message ?? "The fleet couldn't be loaded."}</Alert>
        <Button
          variant="outline"
          onClick={() => {
            void fleet.refetch();
            void config.refetch();
          }}
        >
          Try again
        </Button>
      </div>
    );
  }

  if (vehicles.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <EmptyState
          icon={Truck}
          title="No vehicles yet"
          action={canManage ? <ButtonLink href="/vehicles/new">Add a vehicle</ButtonLink> : undefined}
        >
          Vehicles appear here once they&apos;re added and reporting positions.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {header}
      {fleet.isError && (
        <Alert variant="error">
          Positions couldn&apos;t be refreshed. Showing the last ones received, and trying again.
        </Alert>
      )}
      {positioned === 0 && (
        <Alert variant="info">
          None of your vehicles has reported a position yet.{" "}
          <Link href="/tracking" className="link">
            Connect a tracking device
          </Link>
        </Alert>
      )}
      {simulated > 0 && (
        <Alert variant="info">
          {simulated === vehicles.length
            ? "All of these positions are simulated test data."
            : `${simulated} of ${vehicles.length} vehicles show simulated test data.`}
        </Alert>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm">
          Search
          <input
            type="search"
            className="input w-full"
            placeholder="Registration, make, model or driver"
            value={filters.search}
            onChange={(event) => setFilters({ ...filters, search: event.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Status
          <select
            className="select"
            value={filters.status}
            onChange={(event) =>
              setFilters({ ...filters, status: event.target.value as Filters["status"] })
            }
          >
            <option value="">All ({searched.length})</option>
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {LIVE_STATUS_LABELS[status]} (
                {searched.filter((vehicle) => vehicle.status === status).length})
              </option>
            ))}
          </select>
        </label>
        <Button variant="outline" onClick={() => setFitRequest((value) => value + 1)}>
          Show all on map
        </Button>
      </div>
      <div className="grid overflow-hidden rounded-box border border-base-300 bg-base-100 lg:grid-cols-[1fr_22rem]">
        <div className="isolate h-96 lg:h-[36rem]">
          <MapBoundary
            fallback={
              <div className="fleet-map flex h-full w-full items-center justify-center p-6 text-center text-sm text-neutral-content">
                <span>
                  <MapPinOff aria-hidden className="mx-auto mb-2 size-6" />
                  This device can&apos;t display the map. The vehicle list still shows current
                  positions.
                </span>
              </div>
            }
          >
            <LiveMapCanvas
              vehicles={shown}
              selected={selected}
              route={route}
              geofences={mapFences}
              focusRequest={focusRequest}
              fitRequest={fitRequest}
              onSelect={setSelectedId}
            />
          </MapBoundary>
        </div>
        <div className="border-t border-base-300 lg:h-[36rem] lg:overflow-y-auto lg:border-t-0 lg:border-l">
          {selected && (
            <VehicleDetails
              key={selected.id}
              vehicle={selected}
              canViewDrivers={canViewDrivers}
              onClose={() => setSelectedId(null)}
              onRoute={setRoute}
            />
          )}
          {shown.length === 0 ? (
            <div className="p-4 text-sm">
              <p>No vehicles match these filters.</p>
              <Button
                variant="ghost"
                size="md"
                className="mt-2"
                onClick={() => setFilters({ search: "", status: "" })}
              >
                Clear filters
              </Button>
            </div>
          ) : (
            <ul aria-label="Vehicles" className="divide-y divide-base-300">
              {shown.slice(0, MAX_LISTED).map((vehicle) => (
                <VehicleRow
                  key={vehicle.id}
                  vehicle={vehicle}
                  selected={vehicle.id === selectedId}
                  onSelect={() => {
                    setSelectedId(vehicle.id);
                    setFocusRequest((value) => value + 1);
                  }}
                />
              ))}
            </ul>
          )}
          {shown.length > MAX_LISTED && (
            <p className="border-t border-base-300 p-3 text-xs opacity-75">
              Showing the first {MAX_LISTED} of {shown.length}. Search to find others.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
