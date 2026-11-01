import { z } from "zod";

import { AVAILABILITIES, DRIVER_STATUSES, type Driver, type DriverPayload } from "./api";

export const driverSchema = z.object({
  first_name: z.string().trim().min(1, "Please enter a first name.").max(100),
  last_name: z.string().trim().min(1, "Please enter a last name.").max(100),
  phone: z
    .string()
    .trim()
    .refine(
      (value) => value === "" || /^\+?[0-9][0-9 ()-]{5,30}$/.test(value),
      "Use a phone number, such as +254 712 345678.",
    ),
  email: z.union([z.literal(""), z.email("Please enter a valid email address.")]),
  licence_number: z
    .string()
    .trim()
    .toUpperCase()
    .regex(
      /^[A-Z0-9][A-Z0-9 /-]{2,63}$/,
      "Use 3 to 64 letters, numbers, spaces, hyphens or slashes.",
    ),
  licence_class: z.string().trim().max(32),
  licence_country_code: z
    .string()
    .trim()
    .toUpperCase()
    .refine((value) => value === "" || /^[A-Z]{2}$/.test(value), "Use a two-letter country code."),
  licence_expires_on: z.string(),
  status: z.enum(DRIVER_STATUSES),
  availability: z.enum(AVAILABILITIES),
});

export type DriverValues = z.infer<typeof driverSchema>;

export const EMPTY_DRIVER: DriverValues = {
  first_name: "",
  last_name: "",
  phone: "",
  email: "",
  licence_number: "",
  licence_class: "",
  licence_country_code: "",
  licence_expires_on: "",
  status: "active",
  availability: "available",
};

export function toValues(driver: Driver): DriverValues {
  return {
    first_name: driver.first_name,
    last_name: driver.last_name,
    phone: driver.phone ?? "",
    email: driver.email ?? "",
    licence_number: driver.licence_number,
    licence_class: driver.licence_class ?? "",
    licence_country_code: driver.licence_country_code ?? "",
    licence_expires_on: driver.licence_expires_on ?? "",
    status: driver.status,
    availability: driver.availability,
  };
}

export function toPayload(values: DriverValues): DriverPayload {
  const blankToNull = (value: string) => (value === "" ? null : value);
  return {
    ...values,
    phone: blankToNull(values.phone),
    email: blankToNull(values.email),
    licence_class: blankToNull(values.licence_class),
    licence_country_code: blankToNull(values.licence_country_code),
    licence_expires_on: blankToNull(values.licence_expires_on),
  };
}

/** Sends only what changed, so an edit can't overwrite someone else's change to another field. */
export function changedFields(
  values: DriverValues,
  dirty: Partial<Record<keyof DriverValues, unknown>>,
): Partial<DriverPayload> {
  const payload = toPayload(values);
  const changes: Record<string, unknown> = {};
  for (const field of Object.keys(dirty) as (keyof DriverValues)[]) {
    changes[field] = payload[field];
  }
  return changes as Partial<DriverPayload>;
}
