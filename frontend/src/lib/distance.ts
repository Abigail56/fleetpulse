export type DistanceUnit = "km" | "mi";

const KM_PER_MILE = 1.609344;

/** Distances are stored in kilometres and shown in the organisation's chosen unit. */
export function fromKm(km: number, unit: DistanceUnit) {
  const value = unit === "mi" ? km / KM_PER_MILE : km;
  return Math.round(value * 10) / 10;
}

export function toKm(value: number, unit: DistanceUnit) {
  const km = unit === "mi" ? value * KM_PER_MILE : value;
  return Math.round(km * 10) / 10;
}

export function formatDistance(km: number, unit: DistanceUnit) {
  return `${fromKm(km, unit).toLocaleString("en")} ${unit}`;
}
