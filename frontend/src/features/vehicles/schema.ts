import { z } from "zod";

import { type DistanceUnit, fromKm, toKm } from "@/lib/distance";

import {
  FUEL_TYPES,
  OWNERSHIP_TYPES,
  VEHICLE_STATUSES,
  VEHICLE_TYPES,
  type Vehicle,
  type VehiclePayload,
} from "./api";

const MAX_ODOMETER = 99_999_999;

// Text inputs hold strings, so numbers are checked here and converted in toPayload.
export const vehicleSchema = z.object({
  registration_number: z
    .string()
    .trim()
    .min(1, "Please enter the registration number.")
    .max(32, "Use 32 characters or fewer.")
    .regex(/[A-Za-z0-9]/, "It must contain letters or numbers."),
  make: z.string().trim().min(1, "Please enter the make.").max(100),
  model: z.string().trim().min(1, "Please enter the model.").max(100),
  year: z
    .string()
    .trim()
    .refine((value) => value === "" || /^\d{4}$/.test(value), "Use a four-digit year."),
  vehicle_type: z.enum(VEHICLE_TYPES),
  vin: z
    .string()
    .trim()
    .toUpperCase()
    .refine(
      (value) => value === "" || /^[A-Z0-9]{5,32}$/.test(value),
      "Use 5 to 32 letters and numbers.",
    ),
  fuel_type: z.enum(FUEL_TYPES),
  odometer: z
    .string()
    .trim()
    .refine(
      (value) => /^\d+(\.\d)?$/.test(value) && Number(value) <= MAX_ODOMETER,
      "Use a number with at most one decimal place.",
    ),
  ownership_type: z.enum(OWNERSHIP_TYPES),
  owner_name: z.string().trim().max(200),
  status: z.enum(VEHICLE_STATUSES),
});

export type VehicleValues = z.infer<typeof vehicleSchema>;

export const EMPTY_VEHICLE: VehicleValues = {
  registration_number: "",
  make: "",
  model: "",
  year: "",
  vehicle_type: "truck",
  vin: "",
  fuel_type: "diesel",
  odometer: "0",
  ownership_type: "owned",
  owner_name: "",
  status: "idle",
};

export function toValues(vehicle: Vehicle, unit: DistanceUnit): VehicleValues {
  return {
    registration_number: vehicle.registration_number,
    make: vehicle.make,
    model: vehicle.model,
    year: vehicle.year === null ? "" : String(vehicle.year),
    vehicle_type: vehicle.vehicle_type,
    vin: vehicle.vin ?? "",
    fuel_type: vehicle.fuel_type,
    odometer: String(fromKm(Number(vehicle.odometer_km), unit)),
    ownership_type: vehicle.ownership_type,
    owner_name: vehicle.owner_name ?? "",
    status: vehicle.status,
  };
}

export function toPayload(values: VehicleValues, unit: DistanceUnit): VehiclePayload {
  const { odometer, year, vin, owner_name, ...rest } = values;
  return {
    ...rest,
    year: year === "" ? null : Number(year),
    vin: vin === "" ? null : vin,
    owner_name: owner_name === "" ? null : owner_name,
    odometer_km: toKm(Number(odometer), unit),
  };
}

const FIELD_FOR_PAYLOAD: Record<keyof VehicleValues, keyof VehiclePayload> = {
  registration_number: "registration_number",
  make: "make",
  model: "model",
  year: "year",
  vehicle_type: "vehicle_type",
  vin: "vin",
  fuel_type: "fuel_type",
  odometer: "odometer_km",
  ownership_type: "ownership_type",
  owner_name: "owner_name",
  status: "status",
};

/** Sends only what changed, so an edit can't overwrite someone else's change to another field. */
export function changedFields(
  values: VehicleValues,
  dirty: Partial<Record<keyof VehicleValues, unknown>>,
  unit: DistanceUnit,
): Partial<VehiclePayload> {
  const payload = toPayload(values, unit);
  const changes: Record<string, unknown> = {};
  for (const field of Object.keys(dirty) as (keyof VehicleValues)[]) {
    const name = FIELD_FOR_PAYLOAD[field];
    changes[name] = payload[name];
  }
  return changes as Partial<VehiclePayload>;
}
