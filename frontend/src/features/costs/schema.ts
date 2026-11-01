import { format } from "date-fns";
import { z } from "zod";

import { type DistanceUnit, fromKm, toKm } from "@/lib/distance";

import { CATEGORIES, type Expense, type FuelEntry } from "./api";

const positive = (value: string) => value.trim() !== "" && Number(value) > 0;
const notNegative = (value: string) => value.trim() !== "" && Number(value) >= 0;
const blankOrNotNegative = (value: string) => value.trim() === "" || Number(value) >= 0;
const currency = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Use a three-letter currency code, such as KES or USD.");

export const fuelSchema = z.object({
  vehicle_id: z.string().min(1, "Please choose a vehicle."),
  filled_at: z.string().min(1, "Please enter when this was."),
  quantity: z.string().trim().refine(positive, "Use a number above zero."),
  unit: z.enum(["litres", "kwh"]),
  unit_price: z.string().trim().refine(notNegative, "Use a price of zero or more."),
  currency,
  odometer: z.string().trim().refine(blankOrNotNegative, "Use a number, or leave it blank."),
  is_full_tank: z.boolean(),
  station_name: z.string().trim().max(160),
  notes: z.string().trim().max(2000),
});
export type FuelValues = z.infer<typeof fuelSchema>;

export const expenseSchema = z.object({
  vehicle_id: z.string().min(1, "Please choose a vehicle."),
  category: z.enum(CATEGORIES),
  amount: z.string().trim().refine(positive, "Use an amount above zero."),
  currency,
  incurred_on: z.string().min(1, "Please enter a date."),
  vendor: z.string().trim().max(160),
  description: z.string().trim().max(2000),
});
export type ExpenseValues = z.infer<typeof expenseSchema>;

export const nowForInput = () => format(new Date(), "yyyy-MM-dd'T'HH:mm");
export const todayForInput = () => format(new Date(), "yyyy-MM-dd");

export const fuelToValues = (entry: FuelEntry, unit: DistanceUnit): FuelValues => ({
  vehicle_id: entry.vehicle_id,
  filled_at: format(new Date(entry.filled_at), "yyyy-MM-dd'T'HH:mm"),
  quantity: String(Number(entry.quantity)),
  unit: entry.unit,
  unit_price: String(Number(entry.unit_price)),
  currency: entry.currency,
  odometer: entry.odometer_km === null ? "" : String(fromKm(Number(entry.odometer_km), unit)),
  is_full_tank: entry.is_full_tank,
  station_name: entry.station_name ?? "",
  notes: entry.notes ?? "",
});

export const fuelToPayload = (values: FuelValues, unit: DistanceUnit) => ({
  filled_at: new Date(values.filled_at).toISOString(),
  quantity: Number(values.quantity).toFixed(3),
  unit: values.unit,
  unit_price: Number(values.unit_price).toFixed(4),
  currency: values.currency,
  odometer_km: values.odometer ? toKm(Number(values.odometer), unit).toFixed(1) : null,
  is_full_tank: values.is_full_tank,
  station_name: values.station_name || null,
  notes: values.notes || null,
});

export const expenseToValues = (expense: Expense): ExpenseValues => ({
  vehicle_id: expense.vehicle_id,
  category: expense.category,
  amount: String(Number(expense.amount)),
  currency: expense.currency,
  incurred_on: expense.incurred_on,
  vendor: expense.vendor ?? "",
  description: expense.description ?? "",
});

export const expenseToPayload = (values: ExpenseValues) => ({
  category: values.category,
  amount: Number(values.amount).toFixed(2),
  currency: values.currency,
  incurred_on: values.incurred_on,
  vendor: values.vendor || null,
  description: values.description || null,
});
