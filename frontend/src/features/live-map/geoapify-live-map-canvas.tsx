"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import * as maplibregl from "maplibre-gl";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { ROUTE_COLOURS } from "../fleet-map/colours";
import {
  getMapStylePreference,
  getServerMapStylePreference,
  getFleetMapStyleUrl,
  getGeoapifyMapStyleUrl,
  saveMapStylePreference,
  subscribeToMapStylePreference,
  type MapStylePreference,
} from "../fleet-map/map-style";
import type { LatLng } from "../fleet-map/types";
import type { LiveStatus, LiveVehicle } from "./fleet-status";
import { LiveMapFallback } from "./live-map-fallback";

maplibregl.setWorkerUrl(
  `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/maplibre/maplibre-gl-worker.mjs`,
);

const SELECTED_ZOOM = 14;
const MAX_FIT_ZOOM = 13;
const FIT_PADDING = 56;
const NO_GEOFENCES: MapGeofence[] = [];
const WEBGL_FALLBACK_MESSAGE =
  "WebGL isn't available in this browser. Showing vehicle positions without map tiles.";

function supportsWebGL2() {
  if (typeof document === "undefined") return false;
  try {
    return document.createElement("canvas").getContext("webgl2") !== null;
  } catch (error) {
    console.warn("webgl2_detection_failed:", error);
    return false;
  }
}

export type MapGeofence = {
  id: string;
  name: string;
  boundary: LatLng[];
  isRestricted: boolean;
};

const STATUS_COLOURS: Record<Exclude<LiveStatus, "no_position">, string> = {
  ...ROUTE_COLOURS,
  unknown: "#6fb1d6",
};

const toLngLat = ([latitude, longitude]: LatLng): [number, number] => [
  longitude,
  latitude,
];

function markerElement(vehicle: LiveVehicle, selected: boolean) {
  const button = document.createElement("button");
  const status = vehicle.status === "no_position" ? "unknown" : vehicle.status;
  button.type = "button";
  button.className = `fleet-marker fleet-marker--${status}${selected ? " fleet-marker--selected" : ""}`;
  button.setAttribute(
    "aria-label",
    `${vehicle.registration}, ${vehicle.status.replaceAll("_", " ")}${vehicle.isSimulated ? ", simulated data" : ""}`,
  );
  button.title = button.getAttribute("aria-label") ?? vehicle.registration;
  button.style.setProperty("--heading", `${vehicle.headingDegrees ?? 0}deg`);
  button.innerHTML =
    '<span class="fleet-marker__dot"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1 10.5 10 6 8 1.5 10z"/></svg></span>';
  const label = document.createElement("span");
  label.className = "fleet-marker__label";
  label.textContent = vehicle.registration;
  button.append(label);
  return button;
}

function updateMarker(marker: maplibregl.Marker, vehicle: LiveVehicle, selected: boolean) {
  const element = marker.getElement();
  const status = vehicle.status === "no_position" ? "unknown" : vehicle.status;
  element.className = `fleet-marker fleet-marker--${status}${selected ? " fleet-marker--selected" : ""}`;
  element.setAttribute(
    "aria-label",
    `${vehicle.registration}, ${vehicle.status.replaceAll("_", " ")}${vehicle.isSimulated ? ", simulated data" : ""}`,
  );
  element.title = element.getAttribute("aria-label") ?? vehicle.registration;
  element.style.setProperty("--heading", `${vehicle.headingDegrees ?? 0}deg`);
  const label = element.querySelector(".fleet-marker__label");
  if (label) label.textContent = vehicle.registration;
}

function closedRing(boundary: LatLng[]): [number, number][] {
  const ring = boundary.map(toLngLat);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) ring.push(first);
  return ring;
}

function routeFeatures(route: LatLng[]): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  return {
    type: "FeatureCollection",
    features:
      route.length < 2
        ? []
        : [
            {
              type: "Feature",
              properties: {},
              geometry: { type: "LineString", coordinates: route.map(toLngLat) },
            },
          ],
  };
}

function geofenceFeatures(
  geofences: MapGeofence[],
): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  return {
    type: "FeatureCollection",
    features: geofences
      .filter((fence) => fence.boundary.length >= 3)
      .map((fence) => ({
        type: "Feature",
        properties: {
          color: fence.isRestricted ? STATUS_COLOURS.offline : STATUS_COLOURS.stale,
        },
        geometry: { type: "Polygon", coordinates: [closedRing(fence.boundary)] },
      })),
  };
}

export default function GeoapifyLiveMapCanvas({
  vehicles,
  selected,
  route,
  geofences = NO_GEOFENCES,
  focusRequest,
  fitRequest,
  onSelect,
}: {
  vehicles: LiveVehicle[];
  selected: LiveVehicle | null;
  route: LatLng[];
  geofences?: MapGeofence[];
  focusRequest: number;
  fitRequest: number;
  onSelect: (id: string) => void;
}) {
  const { resolvedTheme } = useTheme();
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [webglSupported] = useState(supportsWebGL2);
  const stylePreference = useSyncExternalStore(
    subscribeToMapStylePreference,
    getMapStylePreference,
    getServerMapStylePreference,
  );
  const key = process.env.NEXT_PUBLIC_GEOAPIFY_API_KEY;
  const theme = resolvedTheme === "dark" ? "dark" : "light";
  const styleUrl = key
    ? getGeoapifyMapStyleUrl(key, theme, stylePreference)
    : getFleetMapStyleUrl(theme);
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef(new Map<string, maplibregl.Marker>());
  const initialStyleUrl = useRef(styleUrl);
  const appliedStyleUrl = useRef("");
  const routeRef = useRef(route);
  const geofencesRef = useRef(geofences);
  const onSelectRef = useRef(onSelect);
  const fitted = useRef(false);
  const lastFocus = useRef(focusRequest);
  const lastFit = useRef(fitRequest);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    routeRef.current = route;
    geofencesRef.current = geofences;
  }, [route, geofences]);

  useEffect(() => {
    const element = container.current;
    const firstStyleUrl = initialStyleUrl.current;
    if (!element || !firstStyleUrl || !webglSupported) return;

    const instance = new maplibregl.Map({
      container: element,
      style: firstStyleUrl,
      center: [15, 0],
      zoom: 2,
      cooperativeGestures: true,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      attributionControl: { compact: true },
    });
    instance.touchZoomRotate.disableRotation();
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
    map.current = instance;
    appliedStyleUrl.current = firstStyleUrl;
    const markerRegistry = markers.current;

    let loaded = false;
    instance.on("error", (event) => {
      console.warn("live_map_error:", event.error?.message);
      if (!loaded) {
        setMapError(
          "Map tiles couldn't load. Check the map provider settings and your network connection.",
        );
      }
    });
    instance.on("styleimagemissing", ({ id }) => {
      if (!instance.hasImage(id)) {
        instance.addImage(id, { width: 1, height: 1, data: new Uint8Array(4) });
      }
    });
    instance.on("style.load", () => {
      loaded = true;
      if (!instance.getSource("live-geofences")) {
        instance.addSource("live-geofences", {
          type: "geojson",
          data: geofenceFeatures(geofencesRef.current),
        });
        instance.addLayer({
          id: "live-geofences-fill",
          type: "fill",
          source: "live-geofences",
          paint: { "fill-color": ["get", "color"], "fill-opacity": 0.12 },
        });
        instance.addLayer({
          id: "live-geofences-outline",
          type: "line",
          source: "live-geofences",
          paint: { "line-color": ["get", "color"], "line-opacity": 0.85, "line-width": 2 },
        });
      }
      if (!instance.getSource("live-route")) {
        instance.addSource("live-route", {
          type: "geojson",
          data: routeFeatures(routeRef.current),
        });
        instance.addLayer({
          id: "live-route",
          type: "line",
          source: "live-route",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#2583ff", "line-opacity": 0.9, "line-width": 3 },
        });
      }
      setMapError(null);
      setReady(true);
    });

    return () => {
      for (const marker of markerRegistry.values()) marker.remove();
      markerRegistry.clear();
      instance.remove();
      map.current = null;
      fitted.current = false;
      setReady(false);
    };
  }, [webglSupported]);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !styleUrl || styleUrl === appliedStyleUrl.current) return;
    appliedStyleUrl.current = styleUrl;
    setReady(false);
    instance.setStyle(styleUrl);
  }, [styleUrl]);

  const chooseStyle = (style: MapStylePreference) => saveMapStylePreference(style);

  useEffect(() => {
    if (!ready || !map.current) return;
    const activeIds = new Set(
      vehicles.filter((vehicle) => vehicle.position !== null).map((vehicle) => vehicle.id),
    );
    for (const [id, marker] of markers.current) {
      if (activeIds.has(id)) continue;
      marker.remove();
      markers.current.delete(id);
    }

    for (const vehicle of vehicles) {
      if (!vehicle.position) continue;
      const position = toLngLat(vehicle.position);
      const isSelected = vehicle.id === selected?.id;
      const marker = markers.current.get(vehicle.id);
      if (marker) {
        marker.setLngLat(position);
        updateMarker(marker, vehicle, isSelected);
        continue;
      }

      const element = markerElement(vehicle, isSelected);
      const next = new maplibregl.Marker({ element, anchor: "center" })
        .setLngLat(position)
        .addTo(map.current);
      element.addEventListener("click", () => onSelectRef.current(vehicle.id));
      markers.current.set(vehicle.id, next);
    }
  }, [ready, vehicles, selected]);

  useEffect(() => {
    if (!ready || !map.current) return;
    map.current.getSource<maplibregl.GeoJSONSource>("live-route")?.setData(routeFeatures(route));
  }, [ready, route]);

  useEffect(() => {
    if (!ready || !map.current) return;
    map.current
      .getSource<maplibregl.GeoJSONSource>("live-geofences")
      ?.setData(geofenceFeatures(geofences));
  }, [ready, geofences]);

  const fit = useCallback(() => {
    const instance = map.current;
    if (!instance) return false;
    const points = [
      ...vehicles.flatMap((vehicle) => (vehicle.position ? [vehicle.position] : [])),
      ...route,
    ];
    if (points.length === 0) return false;
    if (points.length === 1) {
      instance.setCenter(toLngLat(points[0]));
      instance.setZoom(SELECTED_ZOOM);
      return true;
    }
    const bounds = new maplibregl.LngLatBounds();
    for (const point of points) bounds.extend(toLngLat(point));
    instance.fitBounds(bounds, { padding: FIT_PADDING, maxZoom: MAX_FIT_ZOOM });
    return true;
  }, [vehicles, route]);

  useEffect(() => {
    if (ready && !fitted.current) fitted.current = fit();
  }, [ready, fit]);

  useEffect(() => {
    if (fitRequest === lastFit.current) return;
    lastFit.current = fitRequest;
    fit();
  }, [fitRequest, fit]);

  useEffect(() => {
    if (focusRequest === lastFocus.current) return;
    lastFocus.current = focusRequest;
    if (!map.current || !selected?.position) return;
    map.current.easeTo({
      center: toLngLat(selected.position),
      zoom: Math.max(map.current.getZoom(), SELECTED_ZOOM),
    });
  }, [focusRequest, selected]);

  const fallbackMessage = webglSupported ? mapError : WEBGL_FALLBACK_MESSAGE;
  if (fallbackMessage) {
    return (
      <LiveMapFallback
        vehicles={vehicles}
        route={route}
        selected={selected}
        onSelect={onSelect}
        message={fallbackMessage}
      />
    );
  }

  return (
    <div className="relative h-full w-full">
      <div
        ref={container}
        className="fleet-map absolute inset-0"
        role="region"
        aria-label="Geoapify map of your vehicles"
      />
      <label className="absolute right-3 top-3 z-10 flex items-center gap-2 rounded-field border border-base-300 bg-base-100/95 px-2.5 py-1.5 text-xs font-medium text-base-content shadow-sm">
        <span>Map style</span>
        <select
          aria-label="Map style"
          value={stylePreference}
          onChange={(event) => {
            const value = event.currentTarget.value;
            if (
              value === "auto" ||
              value === "positron" ||
              value === "osm-bright" ||
              value === "dark-matter"
            ) {
              chooseStyle(value);
            }
          }}
          className="max-w-32 bg-transparent text-xs text-base-content outline-none"
        >
          <option value="auto">Match theme</option>
          <option value="positron">Positron</option>
          <option value="osm-bright">OSM Bright</option>
          <option value="dark-matter">Dark Matter</option>
        </select>
      </label>
    </div>
  );
}
