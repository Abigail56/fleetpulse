"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { cn } from "@/lib/cn";

import { DEMO_FLEET, formatAge } from "./demo-fleet";
import { MapBoundary } from "./map-boundary";
import { RouteFallback } from "./route-fallback";
import { createSimulatedFeed } from "./simulated-feed";
import { type FleetFeed, type FleetStatus, type FleetVehicle, STATUS_LABELS } from "./types";

const LIST_REFRESH_MS = 1000;

function MapLoading() {
  return (
    <div
      role="status"
      aria-label="Loading map"
      className="fleet-map flex h-full w-full items-center justify-center text-xs text-neutral-content/70"
    >
      Loading map…
    </div>
  );
}

// Loaded separately, so visitors don't pay for the map before the page is usable.
const FleetMap = dynamic(() => import("./fleet-map"), { ssr: false, loading: MapLoading });

export function StatusDot({ status }: { status: FleetStatus }) {
  return <span aria-hidden className={`fleet-dot fleet-dot--${status}`} />;
}

function VehicleRow({
  vehicle,
  selected,
  onSelect,
}: {
  vehicle: FleetVehicle;
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
          <span className="font-mono text-sm font-medium">{vehicle.id}</span>
          <span className="inline-flex items-center gap-1.5 text-xs font-medium">
            <StatusDot status={vehicle.status} />
            {STATUS_LABELS[vehicle.status]}
          </span>
        </span>
        <span className="mt-0.5 flex justify-between gap-2 text-xs opacity-75">
          <span className="tabular-nums">
            {vehicle.speedKph === null ? "Speed unknown" : `${vehicle.speedKph} km/h`}
          </span>
          <span className="tabular-nums">{formatAge(vehicle.secondsSinceUpdate)}</span>
        </span>
        {selected && (
          <span className="mt-1.5 block text-xs opacity-85">
            {vehicle.locationName}
            {vehicle.destination && (
              <>
                <br />
                Heading to {vehicle.destination}
              </>
            )}
          </span>
        )}
      </button>
    </li>
  );
}

/** Works with any FleetFeed: swap the simulator for a live source and nothing here changes. */
export function LiveFleetPanel({ feed }: { feed: FleetFeed }) {
  const [vehicles, setVehicles] = useState(() => feed.getSnapshot());
  const [selectedId, setSelectedId] = useState<string | null>(vehicles[0]?.id ?? null);
  const [focusRequest, setFocusRequest] = useState(0);

  useEffect(() => {
    const stop = feed.start();
    const refresh = setInterval(() => setVehicles(feed.getSnapshot()), LIST_REFRESH_MS);
    return () => {
      stop();
      clearInterval(refresh);
    };
  }, [feed]);

  const moving = vehicles.filter((vehicle) => vehicle.status === "moving").length;

  return (
    <figure className="m-0">
      <div className="overflow-hidden rounded-box border border-base-300 bg-base-100">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-base-300 px-4 py-3">
          <span className="text-sm font-semibold">Live fleet</span>
          <span className="font-mono text-xs opacity-75">
            {vehicles.length} vehicles · {moving} moving
          </span>
        </div>
        <div className="grid sm:grid-cols-[3fr_2fr]">
          {/* A fixed height, reserved before the map loads, so nothing shifts. */}
          <div className="isolate h-72 sm:h-96">
            <MapBoundary fallback={<RouteFallback vehicles={vehicles} selectedId={selectedId} />}>
              <FleetMap
                feed={feed}
                selectedId={selectedId}
                focusRequest={focusRequest}
                onSelect={setSelectedId}
              />
            </MapBoundary>
          </div>
          <ul
            aria-label="Vehicles"
            className="divide-y divide-base-300 border-t border-base-300 sm:h-96 sm:overflow-y-auto sm:border-t-0 sm:border-l"
          >
            {vehicles.map((vehicle) => (
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
        </div>
      </div>
      <figcaption className="mt-2 font-mono text-[0.7rem] tracking-wide opacity-70">
        DEMO · SIMULATED VEHICLE DATA
      </figcaption>
    </figure>
  );
}

export function LiveFleet() {
  const [feed] = useState(() =>
    createSimulatedFeed(DEMO_FLEET, {
      animate:
        typeof window === "undefined" ||
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    }),
  );
  return <LiveFleetPanel feed={feed} />;
}
