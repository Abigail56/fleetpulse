"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import * as maplibregl from "maplibre-gl";
import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";

import { ROUTE_COLOURS } from "./colours";
import { createFleetMarkerElement, createFleetPopupContent } from "./map-elements";
import { getFleetMapStyleUrl } from "./map-style";
import type { FleetFeed } from "./types";

export { ROUTE_COLOURS } from "./colours";

// Prefer Geoapify when configured; otherwise use OpenFreeMap's light/dark styles.
export const STYLE_URL = getFleetMapStyleUrl("light");

// Copied to public/ by scripts/copy-map-worker.mjs when dependencies are installed.
maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

const POPUP_REFRESH_MS = 1000;
const SELECTED_ZOOM = 13.5;
const MAX_INITIAL_ZOOM = 13;

const LeafletFleetMap = dynamic(() => import("./leaflet-fleet-map"), { ssr: false });

const toLngLat = ([latitude, longitude]: [number, number]): [number, number] => [
  longitude,
  latitude,
];

function supportsWebGL2() {
  try {
    return Boolean(document.createElement("canvas").getContext("webgl2"));
  } catch {
    return false;
  }
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
  const { resolvedTheme } = useTheme();
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef(new Map<string, maplibregl.Marker>());
  const appliedStyleUrl = useRef("");
  const onSelectRef = useRef(onSelect);
  const [webglSupported] = useState(supportsWebGL2);
  const [ready, setReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const [tilesFailed, setTilesFailed] = useState(false);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    const element = container.current;
    if (!element || !webglSupported || mapFailed) return;
    const vehicles = feed.getSnapshot();
    const bounds = new maplibregl.LngLatBounds();
    for (const vehicle of vehicles) {
      for (const point of vehicle.route) bounds.extend(toLngLat(point));
    }
    let instance: maplibregl.Map;
    try {
      instance = new maplibregl.Map({
        container: element,
        style: getFleetMapStyleUrl("light"),
        bounds,
        fitBoundsOptions: { padding: 36, maxZoom: MAX_INITIAL_ZOOM },
        // Scrolling the page never gets trapped: Ctrl+scroll, or two fingers on a phone, moves the map.
        cooperativeGestures: true,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        attributionControl: { compact: true },
      });
    } catch (error) {
      console.warn("fleet_map_initialization_failed:", error);
      const timer = window.setTimeout(() => setMapFailed(true), 0);
      return () => window.clearTimeout(timer);
    }
    instance.touchZoomRotate.disableRotation();
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
    map.current = instance;
    appliedStyleUrl.current = getFleetMapStyleUrl("light");

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
    instance.on("style.load", () => {
      loaded = true;
      setTilesFailed(false);
      for (const vehicle of feed.getSnapshot()) {
        if (instance.getSource(`route-${vehicle.id}`)) continue;
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
      const element = createFleetMarkerElement(vehicle);
      const popup = new maplibregl.Popup({ offset: 16, maxWidth: "15rem", focusAfterOpen: false });
      popup.on("open", () =>
        popup.setDOMContent(createFleetPopupContent(currentVehicle(vehicle.id) ?? vehicle)),
      );
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
        if (popup?.isOpen()) popup.setDOMContent(createFleetPopupContent(vehicle));
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
  }, [feed, mapFailed, webglSupported]);

  useEffect(() => {
    const instance = map.current;
    const styleUrl = getFleetMapStyleUrl(resolvedTheme === "dark" ? "dark" : "light");
    if (!instance || styleUrl === appliedStyleUrl.current) return;
    appliedStyleUrl.current = styleUrl;
    setReady(false);
    instance.setStyle(styleUrl);
  }, [resolvedTheme]);

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

  if (!webglSupported || mapFailed) {
    return (
      <LeafletFleetMap
        feed={feed}
        selectedId={selectedId}
        focusRequest={focusRequest}
        onSelect={onSelect}
      />
    );
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
