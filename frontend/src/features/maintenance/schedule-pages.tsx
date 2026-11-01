"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { differenceInDays, format } from "date-fns";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Alert } from "@/components/ui/alert";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, SelectInput, TextArea, TextInput } from "@/components/ui/field";
import { useApiFormError } from "@/features/auth/use-api-form-error";
import type { CurrentMembership } from "@/features/organisation/api";
import { ApiError } from "@/lib/api/client";
import { type DistanceUnit, formatDistance } from "@/lib/distance";

import {
  archiveSchedule,
  createSchedule,
  fetchSchedule,
  fetchVehicleOptions,
  MAINTENANCE_KEY,
  type Schedule,
  updateSchedule,
} from "./api";
import { ScheduleStateBadge } from "./badges";
import { dueLabel, formatDay } from "./rows";
import { emptySchedule, scheduleSchema, scheduleToPayload, scheduleToValues, type ScheduleValues } from "./schema";

// Beyond this, a typed-in reading may be well behind the vehicle.
const STALE_ODOMETER_DAYS = 30;

function ScheduleForm({ schedule, unit, vehicleId }: { schedule?: Schedule; unit: DistanceUnit; vehicleId?: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const vehicles = useQuery({
    queryKey: [...MAINTENANCE_KEY, "vehicle-options"],
    queryFn: fetchVehicleOptions,
    enabled: !schedule,
  });
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ScheduleValues>({
    resolver: zodResolver(scheduleSchema),
    defaultValues: schedule ? scheduleToValues(schedule, unit) : emptySchedule(vehicleId ?? "", unit),
  });
  const { formError, clearFormError, handleApiError } = useApiFormError(setError, {
    date_in_future: "last_service_on",
    no_interval: "interval_days",
  });

  async function onSubmit(values: ScheduleValues) {
    clearFormError();
    try {
      const payload = scheduleToPayload(values, unit);
      const saved = schedule
        ? await updateSchedule(schedule.id, payload)
        : await createSchedule({ ...payload, vehicle_id: values.vehicle_id });
      await queryClient.invalidateQueries({ queryKey: MAINTENANCE_KEY });
      toast.success(schedule ? "Schedule updated." : "Schedule created.");
      router.push(`/maintenance/schedules/${saved.id}`);
    } catch (error) {
      handleApiError(error);
    }
  }

  function text(
    name: keyof ScheduleValues,
    label: string,
    options: { required?: boolean; hint?: string; type?: string } = {},
  ) {
    return (
      <Field id={name} label={label} required={options.required} hint={options.hint} error={errors[name]?.message}>
        {(describedBy) => (
          <TextInput
            id={name}
            type={options.type ?? "text"}
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
        {vehicles.isError && <Alert variant="error">Vehicles couldn&apos;t be loaded.</Alert>}
        {!schedule && (
          <Field id="vehicle_id" label="Vehicle" required error={errors.vehicle_id?.message}>
            {(describedBy) => (
              <SelectInput
                // Remounted when options arrive: a select can't show a value it doesn't have yet.
                key={vehicles.data ? "loaded" : "loading"}
                id="vehicle_id"
                disabled={vehicles.isPending}
                aria-invalid={errors.vehicle_id ? true : undefined}
                aria-describedby={describedBy}
                {...register("vehicle_id")}
              >
                <option value="">Choose a vehicle</option>
                {vehicles.data?.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.registration_number} · {item.make} {item.model}
                  </option>
                ))}
              </SelectInput>
            )}
          </Field>
        )}
        {text("name", "Name", { required: true, hint: "Such as Oil change." })}
        <div className="grid gap-5 sm:grid-cols-2">
          {text("interval_days", "Every how many days", { hint: "Whichever comes first decides." })}
          {text("interval_distance", `Every how many ${unit}`)}
          {text("warn_days", "Remind this many days before", { required: true })}
          {text("warn_distance", `Remind this many ${unit} before`, { required: true })}
          {text("last_service_on", "Last done on", {
            type: "date",
            hint: "Blank means today.",
          })}
          {text("last_service_distance", `Odometer when last done, in ${unit}`, {
            hint: "Blank means the current reading.",
          })}
        </div>
        <Field id="notes" label="Notes" error={errors.notes?.message}>
          {(describedBy) => (
            <TextArea id="notes" rows={3} aria-describedby={describedBy} {...register("notes")} />
          )}
        </Field>
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : schedule ? "Save changes" : "Create schedule"}
          </Button>
          <Link
            href={schedule ? `/maintenance/schedules/${schedule.id}` : "/maintenance"}
            className="btn btn-ghost font-medium"
          >
            Cancel
          </Link>
        </div>
      </form>
    </Card>
  );
}

export function NewSchedule({ membership }: { membership: CurrentMembership }) {
  const vehicleId = useSearchParams().get("vehicle") ?? undefined;
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <h1 className="text-3xl font-bold tracking-tight">New schedule</h1>
      <ScheduleForm unit={membership.organisation.distance_unit} vehicleId={vehicleId} />
    </div>
  );
}

function useScheduleFromRoute() {
  const { id } = useParams<{ id: string }>();
  return useQuery({
    queryKey: [...MAINTENANCE_KEY, "schedule", id],
    queryFn: () => fetchSchedule(id),
  });
}

function LoadState({ query }: { query: ReturnType<typeof useScheduleFromRoute> }) {
  if (query.isPending) {
    return (
      <p role="status" className="text-sm opacity-75">
        Loading schedule…
      </p>
    );
  }
  const missing = query.error instanceof ApiError && query.error.status === 404;
  return (
    <div className="flex flex-col items-start gap-3">
      <h1 className="text-3xl font-bold tracking-tight">
        {missing ? "Schedule not found" : "Schedule"}
      </h1>
      <Alert variant="error">{missing ? "This schedule doesn't exist." : query.error?.message}</Alert>
      <ButtonLink href="/maintenance" variant="outline">
        Back to maintenance
      </ButtonLink>
    </div>
  );
}

export function ScheduleDetail({ membership }: { membership: CurrentMembership }) {
  const query = useScheduleFromRoute();
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [now] = useState(() => new Date());
  const archive = useMutation({
    mutationFn: (id: string) => archiveSchedule(id),
    onSuccess: async () => {
      setConfirm(false);
      toast.success("Schedule archived.");
      await queryClient.invalidateQueries({ queryKey: MAINTENANCE_KEY });
    },
    onError: (error) => {
      setConfirm(false);
      toast.error(error.message);
    },
  });
  const schedule = query.data;
  if (!schedule) return <LoadState query={query} />;

  const unit = membership.organisation.distance_unit;
  const canManage = membership.permissions.includes("maintenance.manage");
  const archived = schedule.archived_at !== null;
  const usesDistance = schedule.interval_km !== null;
  const odometerAge = schedule.odometer_recorded_at
    ? differenceInDays(now, new Date(schedule.odometer_recorded_at))
    : null;
  const odometerStale = usesDistance && (odometerAge === null || odometerAge > STALE_ODOMETER_DAYS);
  const rows: [string, React.ReactNode][] = [
    ["Vehicle", <Link key="vehicle" href={`/vehicles/${schedule.vehicle_id}`} className="link">{schedule.vehicle_registration}</Link>],
    ["Repeats", [
      ...(schedule.interval_days ? [`Every ${schedule.interval_days} days`] : []),
      ...(schedule.interval_km ? [`Every ${formatDistance(Number(schedule.interval_km), unit)}`] : []),
    ].join(" or ")],
    ["Next due", dueLabel(schedule, unit).replace(/^Due /, "")],
    ["Last done", `${formatDay(schedule.last_service_on)}, at ${formatDistance(Number(schedule.last_service_km), unit)}`],
    ["Odometer on record", `${formatDistance(Number(schedule.vehicle_odometer_km), unit)}${
      schedule.odometer_recorded_at
        ? `, recorded ${format(new Date(schedule.odometer_recorded_at), "d MMM yyyy")}`
        : ""
    }`],
    ["Notes", schedule.notes ?? "None"],
  ];

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Link href="/maintenance" className="link inline-flex items-center gap-1 text-sm">
        <ArrowLeft aria-hidden className="size-4" />
        Maintenance
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-bold tracking-tight">{schedule.name}</h1>
        <ScheduleStateBadge state={schedule.state} />
      </div>
      {odometerStale && (
        <Alert variant="info">
          This schedule goes by distance, but the odometer reading is typed in by hand and hasn&apos;t
          been updated recently. It may be due sooner than it looks.{" "}
          <Link href={`/vehicles/${schedule.vehicle_id}/edit`} className="link">
            Update the odometer
          </Link>
        </Alert>
      )}
      {canManage && !archived && (
        <div className="flex flex-wrap gap-3">
          {schedule.open_work_order_id ? (
            <ButtonLink href={`/maintenance/work-orders/${schedule.open_work_order_id}`}>
              View the work order
            </ButtonLink>
          ) : (
            <ButtonLink
              href={`/maintenance/work-orders/new?vehicle=${schedule.vehicle_id}&schedule=${schedule.id}`}
            >
              Book this work
            </ButtonLink>
          )}
          <ButtonLink href={`/maintenance/schedules/${schedule.id}/edit`} variant="outline">
            Edit
          </ButtonLink>
          <Button variant="ghost" onClick={() => setConfirm(true)}>
            Archive
          </Button>
        </div>
      )}
      <Card>
        <h2 className="text-lg font-semibold">Details</h2>
        <dl className="mt-3 divide-y divide-base-300 border-y border-base-300 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="grid gap-1 py-3 sm:grid-cols-[1fr_2fr]">
              <dt className="font-medium">{label}</dt>
              <dd className="break-words whitespace-pre-wrap">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <ConfirmDialog
        open={confirm}
        title="Archive this schedule?"
        confirmLabel="Archive"
        busy={archive.isPending}
        onCancel={() => setConfirm(false)}
        onConfirm={() => archive.mutate(schedule.id)}
      >
        It stops sending reminders. Past work orders are kept.
      </ConfirmDialog>
    </div>
  );
}

export function EditSchedule({ membership }: { membership: CurrentMembership }) {
  const query = useScheduleFromRoute();
  const schedule = query.data;
  if (!schedule) return <LoadState query={query} />;
  if (schedule.archived_at) {
    return (
      <div className="flex flex-col items-start gap-3">
        <h1 className="text-3xl font-bold tracking-tight">Edit schedule</h1>
        <Alert variant="info">An archived schedule can&apos;t be changed.</Alert>
      </div>
    );
  }
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <h1 className="text-3xl font-bold tracking-tight">Edit schedule</h1>
      <ScheduleForm schedule={schedule} unit={membership.organisation.distance_unit} />
    </div>
  );
}
