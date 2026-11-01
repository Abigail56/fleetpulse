import { z } from "zod";

import { type DistanceUnit, fromKm, toKm } from "@/lib/distance";

import type { Schedule, SchedulePayload, WorkOrder, WorkOrderPayload } from "./api";

const KM_DECIMALS = 1;
const positiveOrBlank = (value: string) =>
  value.trim() === "" || (Number.isFinite(Number(value)) && Number(value) > 0);
const notNegativeOrBlank = (value: string) =>
  value.trim() === "" || (Number.isFinite(Number(value)) && Number(value) >= 0);

const toKmText = (value: string, unit: DistanceUnit) => toKm(Number(value), unit).toFixed(KM_DECIMALS);
const fromKmText = (value: string | null, unit: DistanceUnit) =>
  value === null ? "" : String(fromKm(Number(value), unit));

export const scheduleSchema = z
  .object({
    vehicle_id: z.string().min(1, "Please choose a vehicle."),
    name: z.string().trim().min(1, "Please enter a name.").max(120),
    interval_days: z
      .string()
      .trim()
      .refine(
        (value) => value === "" || (Number.isInteger(Number(value)) && Number(value) > 0),
        "Use a whole number of days.",
      ),
    interval_distance: z.string().trim().refine(positiveOrBlank, "Use a number above zero."),
    warn_days: z
      .string()
      .trim()
      .refine(
        (value) => Number.isInteger(Number(value)) && Number(value) >= 0 && value !== "",
        "Use a whole number of days.",
      ),
    warn_distance: z
      .string()
      .trim()
      .refine((value) => value !== "" && notNegativeOrBlank(value), "Use a number."),
    last_service_on: z.string(),
    last_service_distance: z.string().trim().refine(notNegativeOrBlank, "Use a number."),
    notes: z.string().trim().max(2000),
  })
  .refine((values) => values.interval_days || values.interval_distance, {
    path: ["interval_days"],
    message: "Set an interval in days, distance or both.",
  });

export type ScheduleValues = z.infer<typeof scheduleSchema>;

export const emptySchedule = (vehicleId: string, unit: DistanceUnit): ScheduleValues => ({
  vehicle_id: vehicleId,
  name: "",
  interval_days: "",
  interval_distance: "",
  warn_days: "14",
  warn_distance: unit === "mi" ? "300" : "500",
  last_service_on: "",
  last_service_distance: "",
  notes: "",
});

export const scheduleToValues = (schedule: Schedule, unit: DistanceUnit): ScheduleValues => ({
  vehicle_id: schedule.vehicle_id,
  name: schedule.name,
  interval_days: schedule.interval_days?.toString() ?? "",
  interval_distance: fromKmText(schedule.interval_km, unit),
  warn_days: schedule.warn_days.toString(),
  warn_distance: fromKmText(schedule.warn_km, unit),
  last_service_on: schedule.last_service_on,
  last_service_distance: fromKmText(schedule.last_service_km, unit),
  notes: schedule.notes ?? "",
});

/** Blank last-service values are left out on creation, so the API uses today and the odometer. */
export function scheduleToPayload(values: ScheduleValues, unit: DistanceUnit): SchedulePayload {
  return {
    name: values.name,
    interval_days: values.interval_days ? Number(values.interval_days) : null,
    interval_km: values.interval_distance ? toKmText(values.interval_distance, unit) : null,
    warn_days: Number(values.warn_days),
    warn_km: toKmText(values.warn_distance, unit),
    ...(values.last_service_on ? { last_service_on: values.last_service_on } : {}),
    ...(values.last_service_distance
      ? { last_service_km: toKmText(values.last_service_distance, unit) }
      : {}),
    notes: values.notes || null,
  };
}

export const workOrderSchema = z.object({
  vehicle_id: z.string().min(1, "Please choose a vehicle."),
  work_type: z.enum(["preventive", "corrective"]),
  title: z.string().trim().min(1, "Please enter a title.").max(160),
  description: z.string().trim().max(4000),
  scheduled_for: z.string(),
  provider_name: z.string().trim().max(160),
  provider_phone: z
    .string()
    .trim()
    .refine(
      (value) => value === "" || /^\+?[0-9][0-9 ()-]{5,30}$/.test(value),
      "Use a phone number, such as +254 712 345678.",
    ),
  provider_email: z.union([z.literal(""), z.email("Please enter a valid email address.")]),
});

export type WorkOrderValues = z.infer<typeof workOrderSchema>;

export const workOrderToValues = (order: WorkOrder): WorkOrderValues => ({
  vehicle_id: order.vehicle_id,
  work_type: order.work_type,
  title: order.title,
  description: order.description ?? "",
  scheduled_for: order.scheduled_for ?? "",
  provider_name: order.provider_name ?? "",
  provider_phone: order.provider_phone ?? "",
  provider_email: order.provider_email ?? "",
});

export const workOrderToPayload = (values: WorkOrderValues): WorkOrderPayload => ({
  title: values.title,
  description: values.description || null,
  scheduled_for: values.scheduled_for || null,
  provider_name: values.provider_name || null,
  provider_phone: values.provider_phone || null,
  provider_email: values.provider_email || null,
});

export const completionSchema = z.object({
  completed_on: z.string(),
  odometer: z.string().trim().refine(notNegativeOrBlank, "Use a number."),
  labour_cost: z.string().trim().refine(notNegativeOrBlank, "Use an amount, or leave it blank."),
  parts_cost: z.string().trim().refine(notNegativeOrBlank, "Use an amount, or leave it blank."),
  completion_notes: z.string().trim().max(4000),
});

export type CompletionValues = z.infer<typeof completionSchema>;

export const completionToPayload = (values: CompletionValues, unit: DistanceUnit) => ({
  ...(values.completed_on ? { completed_on: values.completed_on } : {}),
  ...(values.odometer ? { odometer_km: toKmText(values.odometer, unit) } : {}),
  ...(values.labour_cost ? { labour_cost: Number(values.labour_cost).toFixed(2) } : {}),
  ...(values.parts_cost ? { parts_cost: Number(values.parts_cost).toFixed(2) } : {}),
  ...(values.completion_notes ? { completion_notes: values.completion_notes } : {}),
});
