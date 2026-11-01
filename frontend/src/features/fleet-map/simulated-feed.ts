import { pointAlongRoute, routeLengthMetres } from "./route-geometry";
import type { FleetFeed, FleetStatus, FleetVehicle, LatLng } from "./types";

export type SimulatedVehicle = {
  id: string;
  description: string;
  status: FleetStatus;
  route: LatLng[];
  /** Where on the route it starts, from 0 to 1. Stopped vehicles stay here. */
  startFraction: number;
  cruiseKph?: number;
  secondsSinceUpdate: number;
  locationName: string;
  destination: string | null;
};

type VehicleState = {
  definition: SimulatedVehicle;
  lengthMetres: number;
  metres: number;
  direction: 1 | -1;
  elapsed: number;
  secondsSinceUpdate: number;
};

const TICK_MS = 100;
const MAX_STEP_SECONDS = 1;
const REPORT_EVERY_SECONDS = 5;
// A demo at true speed barely moves on screen. The displayed speed stays realistic.
const TIME_SCALE = 3;

function currentSpeedKph(state: VehicleState) {
  const cruise = state.definition.cruiseKph ?? 45;
  // Gentle variation, as traffic would cause, without ever stopping.
  return Math.round(cruise + Math.sin(state.elapsed / 9) * (cruise * 0.2));
}

function toVehicle(state: VehicleState): FleetVehicle {
  const { definition } = state;
  const moving = definition.status === "moving";
  const point = pointAlongRoute(definition.route, state.metres);
  return {
    id: definition.id,
    description: definition.description,
    status: definition.status,
    position: point.position,
    headingDegrees: state.direction === 1 ? point.headingDegrees : (point.headingDegrees + 180) % 360,
    speedKph: moving ? currentSpeedKph(state) : definition.status === "idle" ? 0 : null,
    secondsSinceUpdate: Math.floor(state.secondsSinceUpdate),
    locationName: definition.locationName,
    destination: definition.destination,
    route: definition.route,
  };
}

/** Pure, so movement can be tested without timers. */
export function advance(state: VehicleState, seconds: number): VehicleState {
  const next = { ...state, elapsed: state.elapsed + seconds };
  if (state.definition.status !== "moving") {
    next.secondsSinceUpdate = state.secondsSinceUpdate + seconds;
    return next;
  }
  const since = state.secondsSinceUpdate + seconds;
  next.secondsSinceUpdate = since >= REPORT_EVERY_SECONDS ? 0 : since;
  const step = ((currentSpeedKph(state) * 1000) / 3600) * seconds * TIME_SCALE;
  let metres = state.metres + step * state.direction;
  let direction = state.direction;
  // Turns around at the end of the route rather than teleporting back to the start.
  if (metres >= state.lengthMetres) {
    metres = state.lengthMetres;
    direction = -1;
  } else if (metres <= 0) {
    metres = 0;
    direction = 1;
  }
  next.metres = metres;
  next.direction = direction;
  return next;
}

export function initialState(definition: SimulatedVehicle): VehicleState {
  const lengthMetres = routeLengthMetres(definition.route);
  return {
    definition,
    lengthMetres,
    metres: lengthMetres * definition.startFraction,
    direction: 1,
    elapsed: 0,
    secondsSinceUpdate: definition.secondsSinceUpdate,
  };
}

export function createSimulatedFeed(
  definitions: SimulatedVehicle[],
  options: { animate?: boolean } = {},
): FleetFeed {
  const animate = options.animate ?? true;
  let states = definitions.map(initialState);
  let snapshot = states.map(toVehicle);
  const listeners = new Set<() => void>();

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start() {
      let last = performance.now();
      const timer = setInterval(() => {
        const now = performance.now();
        // A background tab can sleep for minutes; nothing should leap when it wakes.
        const seconds = Math.min((now - last) / 1000, MAX_STEP_SECONDS);
        last = now;
        states = states.map((state) =>
          // With reduced motion, the clock still runs but vehicles stay where they are.
          animate
            ? advance(state, seconds)
            : { ...state, secondsSinceUpdate: state.secondsSinceUpdate + seconds },
        );
        snapshot = states.map(toVehicle);
        for (const listener of listeners) listener();
      }, TICK_MS);
      return () => clearInterval(timer);
    },
  };
}
