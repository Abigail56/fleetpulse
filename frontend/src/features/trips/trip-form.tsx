"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, SelectInput, TextArea, TextInput } from "@/components/ui/field";
import { useApiFormError } from "@/features/auth/use-api-form-error";

import { createTrip, fetchTripOptions, type Trip, TRIPS_KEY, updateTrip } from "./api";
import { EMPTY_TRIP, toPayload, toValues, tripSchema, type TripValues } from "./schema";

export function TripForm({ trip }: { trip?: Trip }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const options = useQuery({ queryKey: [...TRIPS_KEY, "options"], queryFn: fetchTripOptions });
  // Once a driver has been told, the route and people can't change. The API enforces this too.
  const underway = trip?.status === "dispatched" || trip?.status === "in_progress";
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting, dirtyFields },
  } = useForm<TripValues>({
    resolver: zodResolver(tripSchema),
    values: trip ? toValues(trip) : EMPTY_TRIP,
    resetOptions: { keepDirtyValues: true },
  });
  const { formError, clearFormError, handleApiError } = useApiFormError(setError, {
    arrival_before_departure: "estimated_arrival_at",
  });
  const cancelHref = trip ? `/trips/${trip.id}` : "/trips";

  async function onSubmit(values: TripValues) {
    clearFormError();
    try {
      const saved = trip
        ? await updateTrip(
            trip.id,
            toPayload(values, Object.keys(dirtyFields) as (keyof TripValues)[]),
          )
        : await createTrip(toPayload(values));
      await queryClient.invalidateQueries({ queryKey: TRIPS_KEY });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(trip ? "Trip updated." : "Trip created.");
      router.push(`/trips/${saved.id}`);
    } catch (error) {
      handleApiError(error);
    }
  }

  function text(name: "origin_name" | "destination_name", label: string) {
    return (
      <Field id={name} label={label} required error={errors[name]?.message}>
        {(describedBy) => (
          <TextInput
            id={name}
            autoComplete="off"
            disabled={underway}
            aria-invalid={errors[name] ? true : undefined}
            aria-describedby={describedBy}
            {...register(name)}
          />
        )}
      </Field>
    );
  }

  function time(
    name: "planned_departure_at" | "estimated_arrival_at",
    label: string,
    disabled: boolean,
  ) {
    return (
      <Field
        id={name}
        label={label}
        hint="In your device's time zone."
        error={errors[name]?.message}
      >
        {(describedBy) => (
          <TextInput
            id={name}
            type="datetime-local"
            disabled={disabled}
            aria-invalid={errors[name] ? true : undefined}
            aria-describedby={describedBy}
            {...register(name)}
          />
        )}
      </Field>
    );
  }

  // A trip's current choice stays selectable even if it has since become unavailable.
  const vehicles = options.data?.vehicles ?? [];
  const drivers = options.data?.drivers ?? [];
  const currentVehicleMissing =
    trip?.vehicle_id && !vehicles.some((item) => item.id === trip.vehicle_id);
  const currentDriverMissing =
    trip?.driver_id && !drivers.some((item) => item.id === trip.driver_id);

  return (
    <Card>
      <form noValidate onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
        {formError && <Alert variant="error">{formError.message}</Alert>}
        {options.isError && (
          <Alert variant="error">Vehicles and drivers couldn&apos;t be loaded.</Alert>
        )}
        {underway && (
          <Alert variant="info">
            This trip has been dispatched, so only the estimated arrival and notes can change. To
            change anything else, cancel it and create a new one.
          </Alert>
        )}
        <div className="grid gap-5 sm:grid-cols-2">
          {text("origin_name", "Origin")}
          {text("destination_name", "Destination")}
          <Field id="vehicle_id" label="Vehicle">
            {(describedBy) => (
              <SelectInput
                // Remounted when options arrive: a select can't show a value it doesn't have yet.
                key={options.data ? "loaded" : "loading"}
                id="vehicle_id"
                disabled={underway || options.isPending}
                aria-describedby={describedBy}
                {...register("vehicle_id")}
              >
                <option value="">Not assigned yet</option>
                {currentVehicleMissing && (
                  <option value={trip.vehicle_id!}>{trip.vehicle_registration}</option>
                )}
                {vehicles.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.registration_number} · {item.make} {item.model}
                  </option>
                ))}
              </SelectInput>
            )}
          </Field>
          <Field id="driver_id" label="Driver">
            {(describedBy) => (
              <SelectInput
                key={options.data ? "loaded" : "loading"}
                id="driver_id"
                disabled={underway || options.isPending}
                aria-describedby={describedBy}
                {...register("driver_id")}
              >
                <option value="">Not assigned yet</option>
                {currentDriverMissing && (
                  <option value={trip.driver_id!}>{trip.driver_name}</option>
                )}
                {drivers.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </SelectInput>
            )}
          </Field>
          {time("planned_departure_at", "Planned departure", underway)}
          {time("estimated_arrival_at", "Estimated arrival", false)}
        </div>
        <Field
          id="dispatch_notes"
          label="Dispatch notes"
          hint="Visible to everyone who can see this trip, including the driver."
          error={errors.dispatch_notes?.message}
        >
          {(describedBy) => (
            <TextArea
              id="dispatch_notes"
              rows={4}
              aria-invalid={errors.dispatch_notes ? true : undefined}
              aria-describedby={describedBy}
              {...register("dispatch_notes")}
            />
          )}
        </Field>
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : trip ? "Save changes" : "Create trip"}
          </Button>
          <Link href={cancelHref} className="btn btn-ghost font-medium">
            Cancel
          </Link>
        </div>
      </form>
    </Card>
  );
}
