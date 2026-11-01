"use client";

import type { FieldErrors, UseFormRegister } from "react-hook-form";

import { Field, SelectInput, TextInput } from "@/components/ui/field";

import type { OrganisationValues } from "./schemas";

function timeZones(current: string) {
  const zones = Intl.supportedValuesOf("timeZone");
  return [...new Set(["UTC", current, ...zones])];
}

export function OrganisationFields({
  register,
  errors,
  currentTimezone,
}: {
  register: UseFormRegister<OrganisationValues>;
  errors: FieldErrors<OrganisationValues>;
  currentTimezone: string;
}) {
  return (
    <>
      <Field id="name" label="Organisation name" required error={errors.name?.message}>
        {(describedBy) => (
          <TextInput
            id="name"
            autoComplete="organization"
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={describedBy}
            {...register("name")}
          />
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="country_code"
          label="Country code"
          required
          hint="Two letters, such as KE or GB."
          error={errors.country_code?.message}
        >
          {(describedBy) => (
            <TextInput
              id="country_code"
              maxLength={2}
              className="uppercase"
              aria-invalid={errors.country_code ? true : undefined}
              aria-describedby={describedBy}
              {...register("country_code")}
            />
          )}
        </Field>
        <Field
          id="default_currency"
          label="Default currency"
          required
          hint="Three letters, such as KES or USD."
          error={errors.default_currency?.message}
        >
          {(describedBy) => (
            <TextInput
              id="default_currency"
              maxLength={3}
              className="uppercase"
              aria-invalid={errors.default_currency ? true : undefined}
              aria-describedby={describedBy}
              {...register("default_currency")}
            />
          )}
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="timezone" label="Time zone" required error={errors.timezone?.message}>
          {(describedBy) => (
            <SelectInput id="timezone" aria-describedby={describedBy} {...register("timezone")}>
              {timeZones(currentTimezone).map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </SelectInput>
          )}
        </Field>
        <Field id="distance_unit" label="Distance unit" required>
          {() => (
            <SelectInput id="distance_unit" {...register("distance_unit")}>
              <option value="km">Kilometres</option>
              <option value="mi">Miles</option>
            </SelectInput>
          )}
        </Field>
      </div>
    </>
  );
}
