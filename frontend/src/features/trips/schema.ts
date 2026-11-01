import { format } from "date-fns";
import { z } from "zod";

import type { Trip, TripPayload } from "./api";

export const tripSchema = z
  .object({
    origin_name: z.string().trim().min(1, "Please enter an origin.").max(255),
    destination_name: z.string().trim().min(1, "Please enter a destination.").max(255),
    vehicle_id: z.string(),
    driver_id: z.string(),
    planned_departure_at: z.string(),
    estimated_arrival_at: z.string(),
    dispatch_notes: z.string().trim().max(4000),
  })
  .refine(
    (values) =>
      !values.planned_departure_at ||
      !values.estimated_arrival_at ||
      new Date(values.estimated_arrival_at) >= new Date(values.planned_departure_at),
    { path: ["estimated_arrival_at"], message: "The estimated arrival must be after the departure." },
  );

export type TripValues = z.infer<typeof tripSchema>;

export const EMPTY_TRIP: TripValues = {
  origin_name: "",
  destination_name: "",
  vehicle_id: "",
  driver_id: "",
  planned_departure_at: "",
  estimated_arrival_at: "",
  dispatch_notes: "",
};

/** The value a datetime-local field expects, in the browser's time zone. */
export const toLocalInput = (iso: string | null) =>
  iso ? format(new Date(iso), "yyyy-MM-dd'T'HH:mm") : "";

export const fromLocalInput = (value: string) => (value ? new Date(value).toISOString() : null);

export function toValues(trip: Trip): TripValues {
  return {
    origin_name: trip.origin_name,
    destination_name: trip.destination_name,
    vehicle_id: trip.vehicle_id ?? "",
    driver_id: trip.driver_id ?? "",
    planned_departure_at: toLocalInput(trip.planned_departure_at),
    estimated_arrival_at: toLocalInput(trip.estimated_arrival_at),
    dispatch_notes: trip.dispatch_notes ?? "",
  };
}

export function toPayload(values: TripValues, only?: (keyof TripValues)[]): TripPayload {
  const payload: TripPayload = {
    origin_name: values.origin_name,
    destination_name: values.destination_name,
    vehicle_id: values.vehicle_id || null,
    driver_id: values.driver_id || null,
    planned_departure_at: fromLocalInput(values.planned_departure_at),
    estimated_arrival_at: fromLocalInput(values.estimated_arrival_at),
    dispatch_notes: values.dispatch_notes || null,
  };
  if (!only) return payload;
  return Object.fromEntries(only.map((key) => [key, payload[key]])) as TripPayload;
}
