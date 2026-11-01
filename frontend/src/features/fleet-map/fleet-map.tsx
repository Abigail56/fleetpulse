"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import * as maplibregl from "maplibre-gl";
import { useEffect, useRef, useState } from "react";

import { formatAge } from "./demo-fleet";
import { RouteFallback } from "./route-fallback";
import { type FleetFeed, type FleetStatus, type FleetVehicle, STATUS_LABELS } from "./types";

// Real OpenStreetMap roads. Free, with no API key, and swappable for another provider's style.
export const STYLE_URL =
  process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? "https://tiles.openfreemap.org/styles/dark";

// Copied to public/ by scripts/copy-map-worker.mjs when dependencies are installed.
maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

const POPUP_REFRESH_MS = 1000;
const SELECTED_ZOOM = 13.5;
const MAX_INITIAL_ZOOM = 13;

// Must match the --fleet-* colours in globals.css. Map layers are drawn on canvas, without CSS.
export const ROUTE_COLOURS: Record<FleetStatus, string> = {
  moving: "#3fce7f",
  idle: "#9aa3a3",
  stale: "#e6b34a",
  offline: "#c26a5c",
};

const toLngLat = ([latitude, longitude]: [number, number]): [number, number] => [
  longitude,
  latitude,
];

function markerElement(vehicle: FleetVehicle) {
  const label = `${vehicle.id}, ${STATUS_LABELS[vehicle.status]}`;
  const button = document.createElement("button");
  button.type = "button";
  button.className = `fleet-marker fleet-marker--${vehicle.status}`;
  button.setAttribute("aria-label", label);
  button.style.setProperty("--heading", `${vehicle.headingDegrees}deg`);
  button.innerHTML =
    '<span class="fleet-marker__dot"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1 10.5 10 6 8 1.5 10z"/></svg></span>';
  const name = document.createElement("span");
  name.className = "fleet-marker__label";
  name.textContent = vehicle.id;
  button.append(name);
  return button;
}

/** Built from DOM text nodes, so values can never be read as HTML. */
function popupContent(vehicle: FleetVehicle) {
  const root = document.createElement("div");
  root.className = "fleet-popup";
  const title = document.createElement("p");
  title.className = "fleet-popup__title";
  title.textContent = `${vehicle.id} · ${vehicle.description}`;
  root.append(title);
  const rows: [string, string][] = [
    ["Status", STATUS_LABELS[vehicle.status]],
    ["Speed", vehicle.speedKph === null ? "Not reported" : `${vehicle.speedKph} km/h`],
    ["Last update", formatAge(vehicle.secondsSinceUpdate)],
    ["Location", vehicle.locationName],
  ];
  if (vehicle.destination) rows.push(["Destination", vehicle.destination]);
  for (const [label, value] of rows) {
    const row = document.createElement("p");
    const name = document.createElement("span");
    name.textContent = `${label}: `;
    row.append(name, document.createTextNode(value));
    root.append(row);
  }
  return root;
}

/**
 * MapLibre is driven directly: positions change many times a second, and going through React for
 * each would re-render the page for no benefit. Only selection comes through props.
 */
export default function FleetMap({
  feed,
  selectedId,
  focusRequest,
  onSelect,
}: {
  feed: FleetFeed;
  selectedId: string | null;
  focusRequest: number;
  onSelect: (id: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef(new Map<string, maplibregl.Marker>());
  const onSelectRef = useRef(onSelect);
  const [ready, setReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const [tilesFailed, setTilesFailed] = useState(false);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const vehicles = feed.getSnapshot();
    const bounds = new maplibregl.LngLatBounds();
    for (const vehicle of vehicles) {
      for (const point of vehicle.route) bounds.extend(toLngLat(point));
    }
    const instance = new maplibregl.Map({
      container: element,
      style: STYLE_URL,
      bounds,
      fitBoundsOptions: { padding: 36, maxZoom: MAX_INITIAL_ZOOM },
      // Scrolling the page never gets trapped: Ctrl+scroll, or two fingers on a phone, moves the map.
      cooperativeGestures: true,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      attributionControl: { compact: true },
    });
    instance.touchZoomRotate.disableRotation();
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
    map.current = instance;

    let loaded = false;
    instance.on("error", (event) => {
      console.warn("fleet_map_error:", event.error?.message);
      // Without the style there's no map at all. A failed tile only loses the background.
      if (loaded) setTilesFailed(true);
      else setMapFailed(true);
    });
    // The style refers to a few decorative patterns it doesn't supply; draw those areas plainly.
    instance.on("styleimagemissing", ({ id }) => {
      if (!instance.hasImage(id)) {
        instance.addImage(id, { width: 1, height: 1, data: new Uint8Array(4) });
      }
    });
    instance.on("load", () => {
      loaded = true;
      for (const vehicle of feed.getSnapshot()) {
        instance.addSource(`route-${vehicle.id}`, {
          type: "geojson",
          data: {
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates: vehicle.route.map(toLngLat) },
          },
        } satisfies maplibregl.SourceSpecification);
        instance.addLayer({
          id: `route-${vehicle.id}`,
          type: "line",
          source: `route-${vehicle.id}`,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": ROUTE_COLOURS[vehicle.status],
            "line-width": 2.5,
            "line-opacity": 0.5,
          },
        });
      }
      setReady(true);
    });

    for (const vehicle of vehicles) {
      const element = markerElement(vehicle);
      const popup = new maplibregl.Popup({ offset: 16, maxWidth: "15rem", focusAfterOpen: false });
      popup.on("open", () => popup.setDOMContent(popupContent(currentVehicle(vehicle.id) ?? vehicle)));
      const marker = new maplibregl.Marker({ element, anchor: "center" })
        .setLngLat(toLngLat(vehicle.position))
        .setPopup(popup)
        .addTo(instance);
      element.addEventListener("click", () => onSelectRef.current(vehicle.id));
      markers.current.set(vehicle.id, marker);
    }

    function currentVehicle(id: string) {
      return feed.getSnapshot().find((vehicle) => vehicle.id === id);
    }

    const unsubscribe = feed.subscribe(() => {
      for (const vehicle of feed.getSnapshot()) {
        if (vehicle.status !== "moving") continue;
        const marker = markers.current.get(vehicle.id);
        if (!marker) continue;
        marker.setLngLat(toLngLat(vehicle.position));
        marker.getElement().style.setProperty("--heading", `${vehicle.headingDegrees}deg`);
      }
    });
    const refreshPopup = setInterval(() => {
      for (const vehicle of feed.getSnapshot()) {
        const popup = markers.current.get(vehicle.id)?.getPopup();
        if (popup?.isOpen()) popup.setDOMContent(popupContent(vehicle));
      }
    }, POPUP_REFRESH_MS);

    const registry = markers.current;
    return () => {
      unsubscribe();
      clearInterval(refreshPopup);
      instance.remove();
      map.current = null;
      registry.clear();
      setReady(false);
    };
  }, [feed]);

  useEffect(() => {
    for (const vehicle of feed.getSnapshot()) {
      const selected = vehicle.id === selectedId;
      if (ready && map.current) {
        const instance = map.current;
        instance.setPaintProperty(`route-${vehicle.id}`, "line-width", selected ? 4.5 : 2.5);
        instance.setPaintProperty(`route-${vehicle.id}`, "line-opacity", selected ? 1 : 0.5);
        if (selected) instance.moveLayer(`route-${vehicle.id}`);
      }
      const element = markers.current.get(vehicle.id)?.getElement();
      element?.classList.toggle("fleet-marker--selected", selected);
      element?.setAttribute("aria-pressed", String(selected));
    }
  }, [feed, selectedId, ready]);

  // Choosing from the list brings that vehicle into view, with its details.
  useEffect(() => {
    if (focusRequest === 0 || !selectedId || !map.current) return;
    const marker = markers.current.get(selectedId);
    if (!marker) return;
    for (const other of markers.current.values()) {
      if (other !== marker && other.getPopup()?.isOpen()) other.togglePopup();
    }
    map.current.flyTo({
      center: marker.getLngLat(),
      zoom: Math.max(map.current.getZoom(), SELECTED_ZOOM),
      duration: 800,
    });
    if (!marker.getPopup()?.isOpen()) marker.togglePopup();
  }, [focusRequest, selectedId]);

  if (mapFailed) {
    return <RouteFallback vehicles={feed.getSnapshot()} selectedId={selectedId} />;
  }

  return (
    <div className="relative h-full w-full">
      <div
        ref={container}
        className="fleet-map h-full w-full"
        role="region"
        aria-label="Map of demonstration vehicles"
      />
      {tilesFailed && (
        <p className="absolute inset-x-2 top-2 z-10 rounded-field bg-neutral/90 px-3 py-1.5 text-center text-xs text-neutral-content">
          Part of the map background couldn&apos;t load. Routes and vehicles are still shown.
        </p>
      )}
    </div>
  );
}
