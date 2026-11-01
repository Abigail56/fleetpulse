import type { LatLng } from "./types";

const EARTH_RADIUS_M = 6371008.8;

const radians = (degrees: number) => (degrees * Math.PI) / 180;

export function distanceMetres(from: LatLng, to: LatLng) {
  const phi1 = radians(from[0]);
  const phi2 = radians(to[0]);
  const halfLat = (phi2 - phi1) / 2;
  const halfLng = radians(to[1] - from[1]) / 2;
  const a = Math.sin(halfLat) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(halfLng) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

export function headingDegrees(from: LatLng, to: LatLng) {
  const phi1 = radians(from[0]);
  const phi2 = radians(to[0]);
  const dLng = radians(to[1] - from[1]);
  const y = Math.sin(dLng) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function routeLengthMetres(route: LatLng[]) {
  let total = 0;
  for (let index = 1; index < route.length; index += 1) {
    total += distanceMetres(route[index - 1], route[index]);
  }
  return total;
}

/** The point a distance along a route, interpolated between its points, so nothing ever jumps. */
export function pointAlongRoute(route: LatLng[], metres: number) {
  let remaining = Math.max(0, metres);
  for (let index = 1; index < route.length; index += 1) {
    const from = route[index - 1];
    const to = route[index];
    const segment = distanceMetres(from, to);
    if (remaining <= segment && segment > 0) {
      const ratio = remaining / segment;
      const position: LatLng = [
        from[0] + (to[0] - from[0]) * ratio,
        from[1] + (to[1] - from[1]) * ratio,
      ];
      return { position, headingDegrees: headingDegrees(from, to) };
    }
    remaining -= segment;
  }
  const last = route.length - 1;
  return {
    position: route[last],
    headingDegrees: last > 0 ? headingDegrees(route[last - 1], route[last]) : 0,
  };
}
