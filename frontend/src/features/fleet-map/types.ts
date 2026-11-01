export type LatLng = [latitude: number, longitude: number];

export type FleetStatus = "moving" | "idle" | "stale" | "offline";

export const STATUS_LABELS: Record<FleetStatus, string> = {
  moving: "Moving",
  idle: "Idle",
  stale: "Stale GPS",
  offline: "Offline",
};

export type FleetVehicle = {
  id: string;
  description: string;
  status: FleetStatus;
  position: LatLng;
  headingDegrees: number;
  /** Null when unknown, such as stale or offline: never assumed to be zero. */
  speedKph: number | null;
  secondsSinceUpdate: number;
  locationName: string;
  destination: string | null;
  route: LatLng[];
};

/**
 * What the map and list need from a data source. The demo uses a simulator; a backend feed over
 * WebSockets can implement the same interface without changing the presentation components.
 */
export type FleetFeed = {
  getSnapshot(): FleetVehicle[];
  /** Called whenever positions change. Returns the function that stops listening. */
  subscribe(listener: () => void): () => void;
  /** Starts producing updates. Returns the function that stops them. */
  start(): () => void;
};
