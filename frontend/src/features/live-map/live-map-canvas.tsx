"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import * as maplibregl from "maplibre-gl";
import { useEffect, useRef, useState } from "react";

import { ROUTE_COLOURS, STYLE_URL } from "../fleet-map/fleet-map";
import type { LatLng } from "../fleet-map/types";
import type { LiveStatus, LiveVehicle } from "./fleet-status";

const COLOURS: Record<Exclude<LiveStatus, "no_position">, string> = {
  ...ROUTE_COLOURS,
  unknown: "#6fb1d6",
};
const CLUSTER_MAX_ZOOM = 12;
const SELECTED_ZOOM = 14;
const MAX_FIT_ZOOM = 13;
const FIT_PADDING = 56;
const ARROW_SIZE = 32;

const NO_GEOFENCES: MapGeofence[] = [];

export type MapGeofence = { id: string; name: string; boundary: LatLng[]; isRestricted: boolean };

const toLngLat = ([latitude, longitude]: LatLng): [number, number] => [longitude, latitude];

const statusColour: maplibregl.ExpressionSpecification = [
  "match",
  ["get", "status"],
  ...Object.entries(COLOURS).flat(),
  COLOURS.unknown,
] as unknown as maplibregl.ExpressionSpecification;

function collection(vehicles: LiveVehicle[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: vehicles.flatMap((vehicle) =>
      vehicle.position
        ? [
            {
              type: "Feature" as const,
              properties: {
                id: vehicle.id,
                status: vehicle.status,
                // Simulated data stays labelled wherever it appears.
                label: vehicle.isSimulated
                  ? `${vehicle.registration} · Simulated`
                  : vehicle.registration,
                // The direction arrow only appears for a real, current heading.
                heading: vehicle.status === "moving" ? vehicle.headingDegrees : null,
              },
              geometry: { type: "Point" as const, coordinates: toLngLat(vehicle.position) },
            },
          ]
        : [],
    ),
  };
}

function routeData(route: LatLng[]): GeoJSON.Feature {
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates: route.map(toLngLat) },
  };
}

function geofenceData(geofences: MapGeofence[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: geofences.map((fence) => ({
      type: "Feature",
      properties: { name: fence.name, restricted: fence.isRestricted },
      geometry: { type: "Polygon", coordinates: [fence.boundary.map(toLngLat)] },
    })),
  };
}

function arrowImage() {
  const canvas = document.createElement("canvas");
  canvas.width = ARROW_SIZE;
  canvas.height = ARROW_SIZE;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = "#0e1a1c";
  context.beginPath();
  context.moveTo(16, 7);
  context.lineTo(24, 24);
  context.lineTo(16, 20);
  context.lineTo(8, 24);
  context.closePath();
  context.fill();
  return context.getImageData(0, 0, ARROW_SIZE, ARROW_SIZE);
}

function addLayers(instance: maplibregl.Map) {
  instance.addSource("fleet-geofences", { type: "geojson", data: geofenceData([]) });
  const fenceColour: maplibregl.ExpressionSpecification = [
    "case",
    ["get", "restricted"],
    COLOURS.offline,
    COLOURS.stale,
  ];
  instance.addLayer({
    id: "fleet-geofences-fill",
    type: "fill",
    source: "fleet-geofences",
    paint: { "fill-color": fenceColour, "fill-opacity": 0.12 },
  });
  instance.addLayer({
    id: "fleet-geofences-line",
    type: "line",
    source: "fleet-geofences",
    paint: { "line-color": fenceColour, "line-width": 1.5 },
  });
  instance.addSource("fleet-route", { type: "geojson", data: routeData([]) });
  instance.addSource("fleet-vehicles", {
    type: "geojson",
    data: collection([]),
    cluster: true,
    clusterMaxZoom: CLUSTER_MAX_ZOOM,
    clusterRadius: 48,
  });
  instance.addSource("fleet-selected", { type: "geojson", data: collection([]) });

  instance.addLayer({
    id: "fleet-route",
    type: "line",
    source: "fleet-route",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#ffffff", "line-width": 3, "line-opacity": 0.85 },
  });
  instance.addLayer({
    id: "fleet-clusters",
    type: "circle",
    source: "fleet-vehicles",
    filter: ["has", "point_count"],
    paint: {
      "circle-color": "#1d3a40",
      "circle-stroke-color": "#e8eeee",
      "circle-stroke-width": 1.5,
      "circle-radius": ["step", ["get", "point_count"], 16, 10, 20, 100, 26],
    },
  });
  instance.addLayer({
    id: "fleet-vehicles",
    type: "circle",
    source: "fleet-vehicles",
    filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-color": statusColour,
      "circle-radius": 8,
      "circle-stroke-color": "#0e1a1c",
      "circle-stroke-width": 1.5,
    },
  });
  instance.addLayer({
    id: "fleet-selected",
    type: "circle",
    source: "fleet-selected",
    paint: {
      "circle-color": statusColour,
      "circle-radius": 10,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 3,
    },
  });

  const arrow = arrowImage();
  if (arrow) {
    instance.addImage("fleet-arrow", arrow);
    for (const source of ["fleet-vehicles", "fleet-selected"]) {
      instance.addLayer({
        id: `${source}-arrow`,
        type: "symbol",
        source,
        filter: ["all", ["!", ["has", "point_count"]], ["!=", ["typeof", ["get", "heading"]], "null"]],
        layout: {
          "icon-image": "fleet-arrow",
          "icon-size": 0.5,
          "icon-rotate": ["coalesce", ["get", "heading"], 0],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
        },
      });
    }
  }

  // Text needs fonts from the map style, so it's only added if the style has them.
  const style = instance.getStyle();
  if (!style.glyphs) return;
  const font = style.layers.flatMap((layer) => {
    const value = layer.type === "symbol" ? layer.layout?.["text-font"] : undefined;
    return Array.isArray(value) && value.every((item) => typeof item === "string")
      ? [value as string[]]
      : [];
  })[0] ?? ["Noto Sans Regular"];
  instance.addLayer({
    id: "fleet-cluster-count",
    type: "symbol",
    source: "fleet-vehicles",
    filter: ["has", "point_count"],
    layout: {
      "text-field": ["get", "point_count_abbreviated"],
      "text-font": font,
      "text-size": 12,
      "text-allow-overlap": true,
    },
    paint: { "text-color": "#ffffff" },
  });
  for (const source of ["fleet-vehicles", "fleet-selected"]) {
    instance.addLayer({
      id: `${source}-label`,
      type: "symbol",
      source,
      filter: ["!", ["has", "point_count"]],
      layout: {
        "text-field": ["get", "label"],
        "text-font": font,
        "text-size": 12,
        "text-offset": [0, 1.3],
        "text-anchor": "top",
      },
      paint: { "text-color": "#ffffff", "text-halo-color": "#0e1a1c", "text-halo-width": 1.5 },
    });
  }
}

/** Drawn on the map canvas rather than as page elements, so large fleets stay smooth. */
export default function LiveMapCanvas({
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
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const onSelectRef = useRef(onSelect);
  const sent = useRef<Record<string, string>>({});
  const fitted = useRef(false);
  const [ready, setReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const [tilesFailed, setTilesFailed] = useState(false);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const instance = new maplibregl.Map({
      container: element,
      style: STYLE_URL,
      center: [0, 15],
      zoom: 1,
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
      if (loaded) setTilesFailed(true);
      else setMapFailed(true);
    });
    instance.on("styleimagemissing", ({ id }) => {
      if (!instance.hasImage(id)) {
        instance.addImage(id, { width: 1, height: 1, data: new Uint8Array(4) });
      }
    });
    instance.on("load", () => {
      loaded = true;
      addLayers(instance);
      setReady(true);
    });
    for (const layer of ["fleet-vehicles", "fleet-selected"]) {
      instance.on("click", layer, (event) => {
        const id = event.features?.[0]?.properties?.id;
        if (typeof id === "string") onSelectRef.current(id);
      });
    }
    instance.on("click", "fleet-clusters", (event) => {
      const feature = event.features?.[0];
      const clusterId = feature?.properties?.cluster_id;
      if (typeof clusterId !== "number" || feature?.geometry.type !== "Point") return;
      const center = feature.geometry.coordinates as [number, number];
      void instance
        .getSource<maplibregl.GeoJSONSource>("fleet-vehicles")
        ?.getClusterExpansionZoom(clusterId)
        .then((zoom) => instance.easeTo({ center, zoom }));
    });
    for (const layer of ["fleet-vehicles", "fleet-selected", "fleet-clusters"]) {
      instance.on("mouseenter", layer, () => {
        instance.getCanvas().style.cursor = "pointer";
      });
      instance.on("mouseleave", layer, () => {
        instance.getCanvas().style.cursor = "";
      });
    }

    const sentData = sent;
    return () => {
      instance.remove();
      map.current = null;
      sentData.current = {};
      fitted.current = false;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    if (!ready || !map.current) return;
    const instance = map.current;
    const update = (source: string, data: GeoJSON.GeoJSON) => {
      // Ages change every second but aren't drawn, so most renders change nothing on the map.
      const json = JSON.stringify(data);
      if (sent.current[source] === json) return;
      sent.current[source] = json;
      instance.getSource<maplibregl.GeoJSONSource>(source)?.setData(data);
    };
    // The selected vehicle is drawn by itself, so a cluster can never hide it.
    update("fleet-vehicles", collection(vehicles.filter((item) => item.id !== selected?.id)));
    update("fleet-selected", collection(selected ? [selected] : []));
    update("fleet-route", routeData(route));
    update("fleet-geofences", geofenceData(geofences));
  }, [ready, vehicles, selected, route, geofences]);

  function fit() {
    const positions = [
      ...vehicles.flatMap((vehicle) => (vehicle.position ? [vehicle.position] : [])),
      ...route,
    ];
    if (!map.current || positions.length === 0) return false;
    const bounds = new maplibregl.LngLatBounds();
    for (const position of positions) bounds.extend(toLngLat(position));
    map.current.fitBounds(bounds, { padding: FIT_PADDING, maxZoom: MAX_FIT_ZOOM, duration: 0 });
    return true;
  }

  useEffect(() => {
    if (ready && !fitted.current) fitted.current = fit();
  });

  const lastFit = useRef(fitRequest);
  useEffect(() => {
    if (fitRequest !== lastFit.current) {
      lastFit.current = fitRequest;
      fit();
    }
  });

  const lastFocus = useRef(focusRequest);
  useEffect(() => {
    if (focusRequest === lastFocus.current) return;
    lastFocus.current = focusRequest;
    if (!map.current || !selected?.position) return;
    map.current.easeTo({
      center: toLngLat(selected.position),
      zoom: Math.max(map.current.getZoom(), SELECTED_ZOOM),
    });
  }, [focusRequest, selected]);

  if (mapFailed) {
    return (
      <div className="fleet-map flex h-full w-full items-center justify-center p-6 text-center text-sm text-neutral-content">
        The map couldn&apos;t load. The vehicle list still shows current positions.
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <div ref={container} className="fleet-map h-full w-full" role="region" aria-label="Map of your vehicles" />
      {tilesFailed && (
        <p className="absolute inset-x-2 top-2 z-10 rounded-field bg-neutral/90 px-3 py-1.5 text-center text-xs text-neutral-content">
          Part of the map background couldn&apos;t load. Vehicles are still shown.
        </p>
      )}
    </div>
  );
}
