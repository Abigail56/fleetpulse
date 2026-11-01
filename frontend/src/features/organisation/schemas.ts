import { z } from "zod";

import { ROLES } from "./roles";

export const organisationSchema = z.object({
  name: z.string().trim().min(1, "Please enter a name.").max(200),
  country_code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, "Use a two-letter country code, such as KE or GB."),
  default_currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Use a three-letter currency code, such as KES or USD."),
  timezone: z.string().min(1, "Please choose a time zone."),
  distance_unit: z.enum(["km", "mi"]),
});
export type OrganisationValues = z.infer<typeof organisationSchema>;

export const invitationSchema = z.object({
  email: z.email("Please enter a valid email address."),
  role: z.enum(ROLES),
});
export type InvitationValues = z.infer<typeof invitationSchema>;
