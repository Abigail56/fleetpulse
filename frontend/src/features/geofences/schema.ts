import { z } from "zod";

import type { Geofence, GeofencePayload } from "./api";

const MIN_POINTS = 3;
const MAX_POINTS = 200;
const METRES_PER_DEGREE = 111_320;
const PREVIEW_SEGMENTS = 48;
const COORDINATE_DECIMALS = 6;

const inRange = (value: string, limit: number) =>
  value.trim() !== "" && Number.isFinite(Number(value)) && Math.abs(Number(value)) <= limit;

/** One "latitude, longitude" pair per line. Returns null if any line can't be read. */
export function parseBoundary(text: string): [number, number][] | null {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const points: [number, number][] = [];
  for (const line of lines) {
    const parts = line.split(/[\s,]+/);
    if (parts.length !== 2 || !inRange(parts[0], 90) || !inRange(parts[1], 180)) return null;
    points.push([Number(parts[0]), Number(parts[1])]);
  }
  return points;
}

export const formatPoint = (latitude: number, longitude: number) =>
  `${latitude.toFixed(COORDINATE_DECIMALS)}, ${longitude.toFixed(COORDINATE_DECIMALS)}`;

export const geofenceSchema = z
  .object({
    name: z.string().trim().min(1, "Please enter a name.").max(100),
    kind: z.enum(["circle", "polygon"]),
    center_latitude: z.string(),
    center_longitude: z.string(),
    radius_m: z.string(),
    boundary: z.string(),
    is_restricted: z.boolean(),
    alert_on_entry: z.boolean(),
    alert_on_exit: z.boolean(),
  })
  .superRefine((values, context) => {
    if (values.kind === "circle") {
      if (!inRange(values.center_latitude, 90)) {
        context.addIssue({
          code: "custom",
          path: ["center_latitude"],
          message: "Use a latitude from -90 to 90.",
        });
      }
      if (!inRange(values.center_longitude, 180)) {
        context.addIssue({
          code: "custom",
          path: ["center_longitude"],
          message: "Use a longitude from -180 to 180.",
        });
      }
      const radius = Number(values.radius_m);
      if (!values.radius_m.trim() || !(radius >= 10 && radius <= 500_000)) {
        context.addIssue({
          code: "custom",
          path: ["radius_m"],
          message: "Use a radius from 10 to 500,000 metres.",
        });
      }
      return;
    }
    const points = parseBoundary(values.boundary);
    if (points === null) {
      context.addIssue({
        code: "custom",
        path: ["boundary"],
        message: "Put one latitude and longitude on each line, such as -1.2921, 36.8219.",
      });
    } else if (points.length < MIN_POINTS || points.length > MAX_POINTS) {
      context.addIssue({
        code: "custom",
        path: ["boundary"],
        message: `A boundary needs ${MIN_POINTS} to ${MAX_POINTS} points.`,
      });
    }
  });

export type GeofenceValues = z.infer<typeof geofenceSchema>;

export const EMPTY_GEOFENCE: GeofenceValues = {
  name: "",
  kind: "circle",
  center_latitude: "",
  center_longitude: "",
  radius_m: "500",
  boundary: "",
  is_restricted: false,
  alert_on_entry: true,
  alert_on_exit: false,
};

export function toValues(geofence: Geofence): GeofenceValues {
  const open = geofence.boundary.slice(0, -1);
  return {
    name: geofence.name,
    kind: geofence.kind,
    center_latitude: geofence.center_latitude?.toString() ?? "",
    center_longitude: geofence.center_longitude?.toString() ?? "",
    radius_m: geofence.radius_m?.toString() ?? "500",
    boundary:
      geofence.kind === "polygon"
        ? open.map(([latitude, longitude]) => formatPoint(latitude, longitude)).join("\n")
        : "",
    is_restricted: geofence.is_restricted,
    alert_on_entry: geofence.alert_on_entry,
    alert_on_exit: geofence.alert_on_exit,
  };
}

export function toPayload(values: GeofenceValues): GeofencePayload {
  const shared = {
    name: values.name,
    kind: values.kind,
    is_restricted: values.is_restricted,
    alert_on_entry: values.alert_on_entry,
    alert_on_exit: values.alert_on_exit,
  };
  if (values.kind === "circle") {
    return {
      ...shared,
      center_latitude: Number(values.center_latitude),
      center_longitude: Number(values.center_longitude),
      radius_m: Number(values.radius_m),
    };
  }
  return { ...shared, boundary: parseBoundary(values.boundary) ?? [] };
}

/** What to draw while editing. The saved shape comes from the database. */
export function previewBoundary(values: GeofenceValues): [number, number][] {
  if (values.kind === "polygon") return parseBoundary(values.boundary) ?? [];
  if (
    !inRange(values.center_latitude, 90) ||
    !inRange(values.center_longitude, 180) ||
    !(Number(values.radius_m) > 0)
  ) {
    return [];
  }
  const latitude = Number(values.center_latitude);
  const longitude = Number(values.center_longitude);
  const radius = Number(values.radius_m) / METRES_PER_DEGREE;
  const scale = Math.max(Math.cos((latitude * Math.PI) / 180), 0.01);
  return Array.from({ length: PREVIEW_SEGMENTS }, (_, index) => {
    const angle = (index / PREVIEW_SEGMENTS) * 2 * Math.PI;
    return [latitude + radius * Math.sin(angle), longitude + (radius * Math.cos(angle)) / scale];
  });
}
