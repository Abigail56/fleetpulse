import type { FleetVehicle } from "./types";

const WIDTH = 400;
const HEIGHT = 320;
const PADDING = 20;

/** Used if the map code itself can't load: routes and positions, with no dependency on anything. */
export function RouteFallback({
  vehicles,
  selectedId,
}: {
  vehicles: FleetVehicle[];
  selectedId: string | null;
}) {
  const points = vehicles.flatMap((vehicle) => vehicle.route);
  const latitudes = points.map((point) => point[0]);
  const longitudes = points.map((point) => point[1]);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLng = Math.min(...longitudes);
  const maxLng = Math.max(...longitudes);
  const x = (lng: number) =>
    PADDING + ((lng - minLng) / (maxLng - minLng || 1)) * (WIDTH - PADDING * 2);
  const y = (lat: number) =>
    HEIGHT - PADDING - ((lat - minLat) / (maxLat - minLat || 1)) * (HEIGHT - PADDING * 2);

  return (
    <div className="fleet-map relative h-full w-full">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-full w-full"
        role="img"
        aria-label="Simplified view of demonstration vehicle routes"
      >
        {vehicles.map((vehicle) => (
          <g key={vehicle.id} className={`fleet-fallback fleet-fallback--${vehicle.status}`}>
            <polyline
              fill="none"
              strokeWidth={vehicle.id === selectedId ? 3 : 1.5}
              strokeOpacity={vehicle.id === selectedId ? 1 : 0.5}
              points={vehicle.route.map(([lat, lng]) => `${x(lng)},${y(lat)}`).join(" ")}
            />
            <circle cx={x(vehicle.position[1])} cy={y(vehicle.position[0])} r={5} />
          </g>
        ))}
      </svg>
      <p className="absolute inset-x-2 top-2 rounded-field bg-neutral/90 px-3 py-1.5 text-center text-xs text-neutral-content">
        The interactive map couldn&apos;t load. This is a simplified view.
      </p>
    </div>
  );
}
