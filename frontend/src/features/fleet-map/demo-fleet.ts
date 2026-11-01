import { DEMO_ROUTES } from "./demo-routes";
import type { SimulatedVehicle } from "./simulated-feed";

/** Invented for the demonstration: not customers, and not connected to any device. */
export const DEMO_FLEET: SimulatedVehicle[] = [
  {
    id: "FP-1042",
    description: "Delivery van",
    status: "moving",
    route: DEMO_ROUTES["FP-1042"],
    startFraction: 0.6,
    cruiseKph: 48,
    secondsSinceUpdate: 2,
    locationName: "On the Ikeja to Yaba route",
    destination: "Yaba depot",
  },
  {
    id: "FP-4417",
    description: "Box truck",
    status: "moving",
    route: DEMO_ROUTES["FP-4417"],
    startFraction: 0.55,
    cruiseKph: 42,
    secondsSinceUpdate: 4,
    locationName: "On the Surulere to Victoria Island route",
    destination: "Victoria Island",
  },
  {
    id: "FP-2178",
    description: "Pickup",
    status: "idle",
    route: DEMO_ROUTES["FP-2178"],
    startFraction: 0.02,
    secondsSinceUpdate: 180,
    locationName: "Oshodi depot, Lagos",
    destination: null,
  },
  {
    id: "FP-3306",
    description: "Delivery van",
    status: "stale",
    route: DEMO_ROUTES["FP-3306"],
    startFraction: 0.6,
    secondsSinceUpdate: 2520,
    locationName: "Near Ojota, Lagos (last known)",
    destination: "Ojota",
  },
  {
    id: "FP-5590",
    description: "Tipper truck",
    status: "offline",
    route: DEMO_ROUTES["FP-5590"],
    startFraction: 0.4,
    secondsSinceUpdate: 19800,
    locationName: "Near Ijora, Lagos (last known)",
    destination: null,
  },
];

export function formatAge(seconds: number) {
  if (seconds < 60) return `${seconds} sec ago`;
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    return `${minutes} min ago`;
  }
  const hours = Math.floor(seconds / 3600);
  if (hours < 48) return `${hours} hr ago`;
  return `${Math.floor(hours / 24)} days ago`;
}
