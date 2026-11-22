"use client";

import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";

import { ROUTE_COLOURS } from "./colours";
import { createFleetMarkerElement, createFleetPopupContent } from "./map-elements";
import { STATUS_LABELS, type FleetFeed } from "./types";

const DEFAULT_CENTER: L.LatLngExpression = [6.46, 3.38];

function tileLayerOptions(key: string | undefined): L.TileLayerOptions {
  return {
    maxZoom: 19,
    attribution: key
      ? '&copy; <a href="https://www.geoapify.com/">Geoapify</a> | &copy; OpenStreetMap contributors'
      : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    crossOrigin: true,
  };
}

function tileLayerUrl(key: string | undefined, dark: boolean) {
  return key
    ? `https://maps.geoapify.com/v1/tile/${dark ? "dark-matter" : "osm-bright"}/{z}/{x}/{y}.png?apiKey=${encodeURIComponent(key)}`
    : "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
}

export default function LeafletFleetMap({
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
  const map = useRef<L.Map | null>(null);
  const tileLayer = useRef<L.TileLayer | null>(null);
  const markers = useRef(new Map<string, L.Marker>());
  const routes = useRef(new Map<string, L.Polyline>());
  const selectedIdRef = useRef(selectedId);
  const onSelectRef = useRef(onSelect);
  const [tilesFailed, setTilesFailed] = useState(false);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    const element = container.current;
    if (!element) return;

    const markerRegistry = markers.current;
    const routeRegistry = routes.current;
    const vehicles = feed.getSnapshot();
    const instance = L.map(element, {
      zoomControl: false,
      scrollWheelZoom: false,
      minZoom: 2,
    }).setView(DEFAULT_CENTER, 11);
    map.current = instance;
    L.control.zoom({ position: "topleft" }).addTo(instance);

    const key = process.env.NEXT_PUBLIC_GEOAPIFY_API_KEY;
    const tiles = L.tileLayer(tileLayerUrl(key, false), tileLayerOptions(key)).addTo(instance);
    tileLayer.current = tiles;
    let tileErrorLogged = false;
    tiles.on("tileerror", (event) => {
      setTilesFailed(true);
      if (!tileErrorLogged) {
        console.warn("fleet_map_tile_error:", event.error?.message ?? "Map tile request failed");
        tileErrorLogged = true;
      }
    });
    tiles.on("tileload", () => setTilesFailed(false));

    for (const vehicle of vehicles) {
      const path = L.polyline(vehicle.route, {
        color: ROUTE_COLOURS[vehicle.status],
        weight: vehicle.id === selectedIdRef.current ? 4.5 : 2.5,
        opacity: vehicle.id === selectedIdRef.current ? 1 : 0.5,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(instance);
      routes.current.set(vehicle.id, path);

      const markerElement = createFleetMarkerElement(vehicle, true);
      const icon = L.divIcon({
        className: "fleet-leaflet-icon",
        html: markerElement,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });
      const markerLabel = `${vehicle.id}, ${STATUS_LABELS[vehicle.status]}`;
      const marker = L.marker(vehicle.position, { icon, title: markerLabel, alt: markerLabel })
        .bindPopup(createFleetPopupContent(vehicle), { maxWidth: 240 })
        .on("click", () => onSelectRef.current(vehicle.id))
        .addTo(instance);
      markers.current.set(vehicle.id, marker);
    }

    const points = vehicles.flatMap((vehicle) => vehicle.route);
    if (points.length > 0) {
      instance.fitBounds(L.latLngBounds(points), { padding: [28, 28], maxZoom: 13 });
    }

    const unsubscribe = feed.subscribe(() => {
      for (const vehicle of feed.getSnapshot()) {
        const marker = markers.current.get(vehicle.id);
        marker?.setLatLng(vehicle.position);
        const markerElement = marker?.getElement()?.querySelector<HTMLElement>(".fleet-marker");
        markerElement?.classList.remove(
          "fleet-marker--moving",
          "fleet-marker--idle",
          "fleet-marker--stale",
          "fleet-marker--offline",
        );
        markerElement?.classList.add(`fleet-marker--${vehicle.status}`);
        markerElement?.style.setProperty("--heading", `${vehicle.headingDegrees}deg`);
        const markerLabel = `${vehicle.id}, ${STATUS_LABELS[vehicle.status]}`;
        marker?.getElement()?.setAttribute("aria-label", markerLabel);
        marker?.getElement()?.setAttribute("title", markerLabel);
        const path = routes.current.get(vehicle.id);
        path?.setLatLngs(vehicle.route);
        path?.setStyle({ color: ROUTE_COLOURS[vehicle.status] });
        const popup = markers.current.get(vehicle.id)?.getPopup();
        if (popup?.isOpen()) popup.setContent(createFleetPopupContent(vehicle));
      }
    });

    return () => {
      unsubscribe();
      instance.remove();
      map.current = null;
      tileLayer.current = null;
      markerRegistry.clear();
      routeRegistry.clear();
    };
  }, [feed]);

  useEffect(() => {
    for (const [id, marker] of markers.current) {
      const selected = id === selectedId;
      const icon = marker.getElement();
      const element = icon?.querySelector<HTMLElement>(".fleet-marker");
      element?.classList.toggle("fleet-marker--selected", selected);
      icon?.setAttribute("aria-pressed", String(selected));
      routes.current.get(id)?.setStyle({
        weight: selected ? 4.5 : 2.5,
        opacity: selected ? 1 : 0.5,
      });
    }
  }, [selectedId]);

  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_GEOAPIFY_API_KEY;
    tileLayer.current?.setUrl(tileLayerUrl(key, resolvedTheme === "dark"));
  }, [resolvedTheme]);

  useEffect(() => {
    if (focusRequest === 0 || !selectedId || !map.current) return;
    const marker = markers.current.get(selectedId);
    if (!marker) return;
    map.current.flyTo(marker.getLatLng(), Math.max(map.current.getZoom(), 13), { duration: 0.8 });
    marker.openPopup();
  }, [focusRequest, selectedId]);

  return (
    <div className="relative h-full w-full">
      <div
        ref={container}
        className="fleet-map fleet-map--leaflet h-full w-full"
        role="region"
        aria-label="Interactive map of demonstration vehicles"
      />
      {tilesFailed && (
        <p className="absolute inset-x-2 top-2 z-10 rounded-field bg-neutral/90 px-3 py-1.5 text-center text-xs text-neutral-content">
          The map background couldn&apos;t load. Routes and vehicle positions remain interactive.
        </p>
      )}
    </div>
  );
}
