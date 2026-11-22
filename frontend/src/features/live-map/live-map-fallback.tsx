import { LIVE_STATUS_LABELS, type LiveVehicle } from "./fleet-status";
import type { LatLng } from "../fleet-map/types";

const WIDTH = 960;
const HEIGHT = 620;
const PADDING = 64;

const STATUS_COLOURS = {
  moving: "#07966f",
  idle: "#d77b0b",
  stale: "#c75d16",
  offline: "#718096",
  unknown: "#168aaf",
  no_position: "#718096",
} as const;

function project([latitude, longitude]: LatLng, bounds: {
  minLatitude: number;
  maxLatitude: number;
  minLongitude: number;
  maxLongitude: number;
}) {
  const longitudeRange = bounds.maxLongitude - bounds.minLongitude || 0.01;
  const latitudeRange = bounds.maxLatitude - bounds.minLatitude || 0.01;
  return [
    PADDING +
      ((longitude - bounds.minLongitude) / longitudeRange) * (WIDTH - PADDING * 2),
    HEIGHT -
      PADDING -
      ((latitude - bounds.minLatitude) / latitudeRange) * (HEIGHT - PADDING * 2),
  ] as const;
}

export function LiveMapFallback({
  vehicles,
  route,
  selected,
  onSelect,
  message,
}: {
  vehicles: LiveVehicle[];
  route: LatLng[];
  selected: LiveVehicle | null;
  onSelect: (id: string) => void;
  message: string;
}) {
  const points = [
    ...vehicles.flatMap((vehicle) => (vehicle.position ? [vehicle.position] : [])),
    ...route,
  ];
  const latitudes = points.map(([latitude]) => latitude);
  const longitudes = points.map(([, longitude]) => longitude);
  const rawMinLatitude = latitudes.length ? Math.min(...latitudes) : -0.01;
  const rawMaxLatitude = latitudes.length ? Math.max(...latitudes) : 0.01;
  const rawMinLongitude = longitudes.length ? Math.min(...longitudes) : -0.01;
  const rawMaxLongitude = longitudes.length ? Math.max(...longitudes) : 0.01;
  const bounds = {
    minLatitude: rawMinLatitude === rawMaxLatitude ? rawMinLatitude - 0.01 : rawMinLatitude,
    maxLatitude: rawMinLatitude === rawMaxLatitude ? rawMaxLatitude + 0.01 : rawMaxLatitude,
    minLongitude: rawMinLongitude === rawMaxLongitude ? rawMinLongitude - 0.01 : rawMinLongitude,
    maxLongitude: rawMinLongitude === rawMaxLongitude ? rawMaxLongitude + 0.01 : rawMaxLongitude,
  };
  const routePoints = route.map((point) => project(point, bounds).join(",")).join(" ");

  return (
    <div className="live-map-fallback relative flex h-full w-full flex-col overflow-hidden rounded-box">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="min-h-0 flex-1"
        role="img"
        aria-label="Simplified live view of vehicle positions"
      >
        {routePoints && (
          <polyline
            points={routePoints}
            fill="none"
            stroke="var(--color-primary)"
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="12 10"
            opacity="0.8"
          />
        )}
        {vehicles.map((vehicle) => {
          if (!vehicle.position) return null;
          const [x, y] = project(vehicle.position, bounds);
          const active = selected?.id === vehicle.id;
          return (
            <g
              key={vehicle.id}
              role="button"
              tabIndex={0}
              aria-label={`${vehicle.registration}, ${LIVE_STATUS_LABELS[vehicle.status]}`}
              aria-pressed={active}
              onClick={() => onSelect(vehicle.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(vehicle.id);
                }
              }}
              className="cursor-pointer outline-none focus-visible:opacity-75"
            >
              {active && (
                <circle
                  cx={x}
                  cy={y}
                  r="24"
                  fill={STATUS_COLOURS[vehicle.status]}
                  opacity="0.18"
                />
              )}
              <circle
                cx={x}
                cy={y}
                r={active ? 12 : 9}
                fill={STATUS_COLOURS[vehicle.status]}
                stroke="var(--color-base-100)"
                strokeWidth="4"
              />
              <text
                x={x + 17}
                y={y + 5}
                fill="var(--color-base-content)"
                fontSize="16"
                fontFamily="var(--font-mono)"
                fontWeight="600"
              >
                {vehicle.registration}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="absolute inset-x-3 top-3 flex flex-wrap items-center justify-between gap-2 rounded-field border border-base-300 bg-base-100/90 px-3 py-2 text-xs shadow-sm backdrop-blur">
        <span className="font-semibold text-primary">Live position view</span>
        <span className="text-base-content/70">{message}</span>
      </div>
      {points.length === 0 && (
        <p className="absolute inset-x-3 bottom-3 rounded-field bg-base-100/90 px-3 py-2 text-center text-sm text-base-content/70">
          No vehicle positions have been reported yet.
        </p>
      )}
    </div>
  );
}
