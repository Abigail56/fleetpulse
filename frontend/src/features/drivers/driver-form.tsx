"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, SelectInput, TextInput } from "@/components/ui/field";
import { useApiFormError } from "@/features/auth/use-api-form-error";

import {
  AVAILABILITIES,
  AVAILABILITY_LABELS,
  createDriver,
  type Driver,
  DRIVER_STATUSES,
  DRIVERS_KEY,
  STATUS_LABELS,
  updateDriver,
} from "./api";
import {
  changedFields,
  type DriverValues,
  driverSchema,
  EMPTY_DRIVER,
  toPayload,
  toValues,
} from "./schema";

export function DriverForm({ driver }: { driver?: Driver }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting, dirtyFields },
  } = useForm<DriverValues>({
    resolver: zodResolver(driverSchema),
    defaultValues: driver ? toValues(driver) : EMPTY_DRIVER,
  });
  const { formError, clearFormError, handleApiError } = useApiFormError(setError, {
    duplicate_licence: "licence_number",
  });
  const cancelHref = driver ? `/drivers/${driver.id}` : "/drivers";

  function text(name: keyof DriverValues, label: string, options: { required?: boolean; hint?: string; type?: string; className?: string; autoComplete?: string } = {}) {
    return (
      <Field
        id={name}
        label={label}
        required={options.required}
        hint={options.hint}
        error={errors[name]?.message}
      >
        {(describedBy) => (
          <TextInput
            id={name}
            type={options.type ?? "text"}
            autoComplete={options.autoComplete ?? "off"}
            className={options.className}
            aria-invalid={errors[name] ? true : undefined}
            aria-describedby={describedBy}
            {...register(name)}
          />
        )}
      </Field>
    );
  }

  return (
    <Card>
      <form
        noValidate
        className="flex flex-col gap-5"
        onSubmit={handleSubmit(async (values) => {
          clearFormError();
          try {
            const saved = driver
              ? await updateDriver(driver.id, {
                  ...changedFields(values, dirtyFields),
                  expected_updated_at: driver.updated_at,
                })
              : await createDriver(toPayload(values));
            await queryClient.invalidateQueries({ queryKey: DRIVERS_KEY });
            await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
            toast.success(driver ? "Driver saved." : "Driver added.");
            // Don't leave personal data in the form while navigating away.
            reset(EMPTY_DRIVER);
            router.push(`/drivers/${saved.id}`);
          } catch (error) {
            handleApiError(error);
          }
        })}
      >
        {formError && <Alert variant="error">{formError.message}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          {text("first_name", "First name", { required: true })}
          {text("last_name", "Last name", { required: true })}
          {text("phone", "Phone", { type: "tel" })}
          {text("email", "Email", { type: "email" })}
          {text("licence_number", "Licence number", { required: true, className: "uppercase" })}
          {text("licence_class", "Licence class")}
          {text("licence_country_code", "Licence country", {
            hint: "Two letters, such as KE or GB.",
            className: "uppercase",
          })}
          {text("licence_expires_on", "Licence expiry", { type: "date" })}
          <Field id="status" label="Status" required>
            {() => (
              <SelectInput id="status" {...register("status")}>
                {DRIVER_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </option>
                ))}
              </SelectInput>
            )}
          </Field>
          <Field id="availability" label="Availability" required>
            {() => (
              <SelectInput id="availability" {...register("availability")}>
                {AVAILABILITIES.map((value) => (
                  <option key={value} value={value}>
                    {AVAILABILITY_LABELS[value]}
                  </option>
                ))}
              </SelectInput>
            )}
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : driver ? "Save changes" : "Add driver"}
          </Button>
          <Link href={cancelHref} className="link text-sm">
            Cancel
          </Link>
        </div>
      </form>
    </Card>
  );
}
