"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, TextArea, TextInput } from "@/components/ui/field";
import { useApiFormError } from "@/features/auth/use-api-form-error";
import { fetchFleet, TRACKING_KEY } from "@/features/tracking/api";

import { MapBoundary } from "../fleet-map/map-boundary";
import { createGeofence, type Geofence, GEOFENCES_KEY, updateGeofence } from "./api";
import {
  EMPTY_GEOFENCE,
  formatPoint,
  geofenceSchema,
  type GeofenceValues,
  previewBoundary,
  toPayload,
  toValues,
} from "./schema";

const COORDINATE_DECIMALS = 6;

const GeofenceMap = dynamic(() => import("./geofence-map"), {
  ssr: false,
  loading: () => (
    <div role="status" className="fleet-map flex h-full w-full items-center justify-center text-xs text-neutral-content/70">
      Loading map…
    </div>
  ),
});

export function GeofenceForm({ geofence }: { geofence?: Geofence }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const {
    control,
    register,
    handleSubmit,
    setError,
    setValue,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<GeofenceValues>({
    resolver: zodResolver(geofenceSchema),
    defaultValues: geofence ? toValues(geofence) : EMPTY_GEOFENCE,
  });
  const { formError, clearFormError, handleApiError } = useApiFormError(setError, {
    duplicate_name: "name",
    invalid_boundary: "boundary",
  });
  const watched = useWatch({ control });
  const values = { ...EMPTY_GEOFENCE, ...watched } as GeofenceValues;
  const kind = values.kind;
  const boundaryKey = JSON.stringify(previewBoundary(values));
  const boundary = useMemo(() => JSON.parse(boundaryKey) as [number, number][], [boundaryKey]);
  // Only to start the map near the fleet: the form works without it.
  const fleet = useQuery({
    queryKey: [...TRACKING_KEY, "fleet"],
    queryFn: fetchFleet,
    retry: false,
  });
  const reference = useMemo(
    () =>
      (fleet.data ?? []).flatMap((row) =>
        row.latitude === null || row.longitude === null
          ? []
          : [[row.latitude, row.longitude] as [number, number]],
      ),
    [fleet.data],
  );
  const cancelHref = geofence ? `/geofences/${geofence.id}` : "/geofences";

  function pick(latitude: number, longitude: number) {
    if (getValues("kind") === "circle") {
      setValue("center_latitude", latitude.toFixed(COORDINATE_DECIMALS));
      setValue("center_longitude", longitude.toFixed(COORDINATE_DECIMALS));
    } else {
      const current = getValues("boundary").trimEnd();
      const line = formatPoint(latitude, longitude);
      setValue("boundary", current ? `${current}\n${line}` : line);
    }
  }

  async function onSubmit(submitted: GeofenceValues) {
    clearFormError();
    try {
      const payload = toPayload(submitted);
      const saved = geofence
        ? await updateGeofence(geofence.id, payload)
        : await createGeofence(payload);
      await queryClient.invalidateQueries({ queryKey: GEOFENCES_KEY });
      toast.success(geofence ? "Geofence updated." : "Geofence created.");
      router.push(`/geofences/${saved.id}`);
    } catch (error) {
      handleApiError(error);
    }
  }

  function coordinate(name: "center_latitude" | "center_longitude" | "radius_m", label: string) {
    return (
      <Field id={name} label={label} required error={errors[name]?.message}>
        {(describedBy) => (
          <TextInput
            id={name}
            inputMode="decimal"
            autoComplete="off"
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
      <form noValidate onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
        {formError && <Alert variant="error">{formError.message}</Alert>}
        <Field id="name" label="Name" required error={errors.name?.message}>
          {(describedBy) => (
            <TextInput
              id="name"
              autoComplete="off"
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={describedBy}
              {...register("name")}
            />
          )}
        </Field>
        <fieldset className="flex flex-wrap gap-4 text-sm">
          <legend className="mb-1.5 font-medium">Shape</legend>
          <label className="flex items-center gap-2">
            <input type="radio" className="radio radio-sm" value="circle" {...register("kind")} />
            Circle
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" className="radio radio-sm" value="polygon" {...register("kind")} />
            Polygon
          </label>
        </fieldset>
        <div className="isolate h-80 overflow-hidden rounded-box">
          <MapBoundary
            fallback={
              <div className="fleet-map flex h-full w-full items-center justify-center p-6 text-center text-sm text-neutral-content">
                This device can&apos;t display the map. You can still type coordinates.
              </div>
            }
          >
            <GeofenceMap boundary={boundary} reference={reference} onPick={pick} />
          </MapBoundary>
        </div>
        <p className="text-xs opacity-75">
          {kind === "circle"
            ? "Click the map to set the centre, or type it below."
            : "Click the map to add each corner in order, or type them below."}
        </p>
        {kind === "circle" ? (
          <div className="grid gap-5 sm:grid-cols-3">
            {coordinate("center_latitude", "Centre latitude")}
            {coordinate("center_longitude", "Centre longitude")}
            {coordinate("radius_m", "Radius in metres")}
          </div>
        ) : (
          <Field
            id="boundary"
            label="Corners"
            required
            hint="One latitude and longitude on each line, such as -1.2921, 36.8219."
            error={errors.boundary?.message}
          >
            {(describedBy) => (
              <TextArea
                id="boundary"
                rows={6}
                className="font-mono"
                aria-invalid={errors.boundary ? true : undefined}
                aria-describedby={describedBy}
                {...register("boundary")}
              />
            )}
          </Field>
        )}
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="mb-1.5 font-medium">Alerts</legend>
          <label className="flex items-center gap-2">
            <input type="checkbox" className="checkbox checkbox-sm" {...register("alert_on_entry")} />
            Alert when a vehicle enters
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" className="checkbox checkbox-sm" {...register("alert_on_exit")} />
            Alert when a vehicle leaves
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" className="checkbox checkbox-sm" {...register("is_restricted")} />
            Restricted area: any entry raises a critical alert
          </label>
        </fieldset>
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : geofence ? "Save changes" : "Create geofence"}
          </Button>
          <Link href={cancelHref} className="btn btn-ghost font-medium">
            Cancel
          </Link>
        </div>
      </form>
    </Card>
  );
}
