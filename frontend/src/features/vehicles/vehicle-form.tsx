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
import type { DistanceUnit } from "@/lib/distance";

import {
  createVehicle,
  FUEL_LABELS,
  FUEL_TYPES,
  OWNERSHIP_LABELS,
  OWNERSHIP_TYPES,
  STATUS_LABELS,
  TYPE_LABELS,
  updateVehicle,
  type Vehicle,
  VEHICLE_STATUSES,
  VEHICLE_TYPES,
  VEHICLES_KEY,
} from "./api";
import {
  changedFields,
  EMPTY_VEHICLE,
  toPayload,
  toValues,
  type VehicleValues,
  vehicleSchema,
} from "./schema";

export function VehicleForm({ vehicle, unit }: { vehicle?: Vehicle; unit: DistanceUnit }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting, dirtyFields },
  } = useForm<VehicleValues>({
    resolver: zodResolver(vehicleSchema),
    defaultValues: vehicle ? toValues(vehicle, unit) : EMPTY_VEHICLE,
  });
  const { formError, clearFormError, handleApiError } = useApiFormError(setError, {
    duplicate_registration: "registration_number",
    duplicate_vin: "vin",
  });
  const cancelHref = vehicle ? `/vehicles/${vehicle.id}` : "/vehicles";

  function invalid(name: keyof VehicleValues) {
    return errors[name] ? true : undefined;
  }

  return (
    <Card>
      <form
        noValidate
        className="flex flex-col gap-5"
        onSubmit={handleSubmit(async (values) => {
          clearFormError();
          try {
            const saved = vehicle
              ? await updateVehicle(vehicle.id, {
                  ...changedFields(values, dirtyFields, unit),
                  expected_updated_at: vehicle.updated_at,
                })
              : await createVehicle(toPayload(values, unit));
            await queryClient.invalidateQueries({ queryKey: VEHICLES_KEY });
            await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
            toast.success(vehicle ? "Vehicle saved." : "Vehicle added.");
            reset(toValues(saved, unit));
            router.push(`/vehicles/${saved.id}`);
          } catch (error) {
            handleApiError(error);
          }
        })}
      >
        {formError && <Alert variant="error">{formError.message}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="registration_number"
            label="Registration number"
            required
            error={errors.registration_number?.message}
          >
            {(describedBy) => (
              <TextInput
                id="registration_number"
                autoComplete="off"
                aria-invalid={invalid("registration_number")}
                aria-describedby={describedBy}
                {...register("registration_number")}
              />
            )}
          </Field>
          <Field id="status" label="Status" required>
            {() => (
              <SelectInput id="status" {...register("status")}>
                {VEHICLE_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </option>
                ))}
              </SelectInput>
            )}
          </Field>
          <Field id="make" label="Make" required error={errors.make?.message}>
            {(describedBy) => (
              <TextInput
                id="make"
                autoComplete="off"
                aria-invalid={invalid("make")}
                aria-describedby={describedBy}
                {...register("make")}
              />
            )}
          </Field>
          <Field id="model" label="Model" required error={errors.model?.message}>
            {(describedBy) => (
              <TextInput
                id="model"
                autoComplete="off"
                aria-invalid={invalid("model")}
                aria-describedby={describedBy}
                {...register("model")}
              />
            )}
          </Field>
          <Field id="year" label="Year" error={errors.year?.message}>
            {(describedBy) => (
              <TextInput
                id="year"
                inputMode="numeric"
                maxLength={4}
                aria-invalid={invalid("year")}
                aria-describedby={describedBy}
                {...register("year")}
              />
            )}
          </Field>
          <Field id="vehicle_type" label="Vehicle type" required>
            {() => (
              <SelectInput id="vehicle_type" {...register("vehicle_type")}>
                {VEHICLE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {TYPE_LABELS[type]}
                  </option>
                ))}
              </SelectInput>
            )}
          </Field>
          <Field id="fuel_type" label="Fuel type" required>
            {() => (
              <SelectInput id="fuel_type" {...register("fuel_type")}>
                {FUEL_TYPES.map((fuel) => (
                  <option key={fuel} value={fuel}>
                    {FUEL_LABELS[fuel]}
                  </option>
                ))}
              </SelectInput>
            )}
          </Field>
          <Field
            id="odometer"
            label={`Odometer (${unit === "mi" ? "miles" : "km"})`}
            required
            error={errors.odometer?.message}
          >
            {(describedBy) => (
              <TextInput
                id="odometer"
                inputMode="decimal"
                aria-invalid={invalid("odometer")}
                aria-describedby={describedBy}
                {...register("odometer")}
              />
            )}
          </Field>
          <Field id="vin" label="VIN" error={errors.vin?.message}>
            {(describedBy) => (
              <TextInput
                id="vin"
                autoComplete="off"
                className="uppercase"
                aria-invalid={invalid("vin")}
                aria-describedby={describedBy}
                {...register("vin")}
              />
            )}
          </Field>
          <Field id="ownership_type" label="Ownership" required>
            {() => (
              <SelectInput id="ownership_type" {...register("ownership_type")}>
                {OWNERSHIP_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {OWNERSHIP_LABELS[type]}
                  </option>
                ))}
              </SelectInput>
            )}
          </Field>
          <Field
            id="owner_name"
            label="Owner or lessor"
            hint="The company you lease or rent from, if any."
            error={errors.owner_name?.message}
          >
            {(describedBy) => (
              <TextInput
                id="owner_name"
                autoComplete="off"
                aria-invalid={invalid("owner_name")}
                aria-describedby={describedBy}
                {...register("owner_name")}
              />
            )}
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : vehicle ? "Save changes" : "Add vehicle"}
          </Button>
          <Link href={cancelHref} className="link text-sm">
            Cancel
          </Link>
        </div>
      </form>
    </Card>
  );
}
