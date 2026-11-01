"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import * as maplibregl from "maplibre-gl";
import { useEffect, useRef, useState } from "react";

import { STYLE_URL } from "../fleet-map/fleet-map";

const FILL_COLOUR = "#e6b34a";
const FIT_PADDING = 48;
const MAX_FIT_ZOOM = 14;

type Point = [number, number];

function shape(boundary: Point[]): GeoJSON.Feature {
  const ring = boundary.map(([latitude, longitude]) => [longitude, latitude]);
  if (ring.length < 3) {
    return { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: ring } };
  }
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: [[...ring, ring[0]]] },
  };
}

/** Clicking sends the position to the form, which also accepts typed coordinates. */
export default function GeofenceMap({
  boundary,
  reference,
  onPick,
}: {
  boundary: Point[];
  /** Where to look when there's no shape yet, such as the fleet's positions. */
  reference: Point[];
  onPick?: (latitude: number, longitude: number) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const onPickRef = useRef(onPick);
  const fitted = useRef(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    onPickRef.current = onPick;
  }, [onPick]);

  useEffect(() => {
    if (!container.current) return;
    const instance = new maplibregl.Map({
      container: container.current,
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
      console.warn("geofence_map_error:", event.error?.message);
      if (!loaded) setFailed(true);
    });
    instance.on("styleimagemissing", ({ id }) => {
      if (!instance.hasImage(id)) {
        instance.addImage(id, { width: 1, height: 1, data: new Uint8Array(4) });
      }
    });
    instance.on("load", () => {
      loaded = true;
      instance.addSource("geofence", { type: "geojson", data: shape([]) });
      instance.addLayer({
        id: "geofence-fill",
        type: "fill",
        source: "geofence",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "fill-color": FILL_COLOUR, "fill-opacity": 0.25 },
      });
      instance.addLayer({
        id: "geofence-line",
        type: "line",
        source: "geofence",
        paint: { "line-color": FILL_COLOUR, "line-width": 2 },
      });
      setReady(true);
    });
    instance.on("click", (event) => onPickRef.current?.(event.lngLat.lat, event.lngLat.lng));
    return () => {
      instance.remove();
      map.current = null;
      fitted.current = false;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    if (!ready || !map.current) return;
    map.current.getSource<maplibregl.GeoJSONSource>("geofence")?.setData(shape(boundary));
    if (fitted.current) return;
    const points = boundary.length > 0 ? boundary : reference;
    if (points.length === 0) return;
    const bounds = new maplibregl.LngLatBounds();
    for (const [latitude, longitude] of points) bounds.extend([longitude, latitude]);
    map.current.fitBounds(bounds, { padding: FIT_PADDING, maxZoom: MAX_FIT_ZOOM, duration: 0 });
    fitted.current = true;
  }, [ready, boundary, reference]);

  if (failed) {
    return (
      <div className="fleet-map flex h-full w-full items-center justify-center p-6 text-center text-sm text-neutral-content">
        The map couldn&apos;t load. You can still type coordinates.
      </div>
    );
  }
  return (
    <div
      ref={container}
      className="fleet-map h-full w-full"
      role="region"
      aria-label={onPick ? "Map: click to set the geofence's position" : "Map of this geofence"}
    />
  );
}
