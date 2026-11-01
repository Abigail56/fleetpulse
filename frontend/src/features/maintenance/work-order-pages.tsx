"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
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
import { VEHICLES_KEY } from "@/features/vehicles/api";
import { ApiError } from "@/lib/api/client";
import { type DistanceUnit, formatDistance } from "@/lib/distance";
import { formatMoney } from "@/lib/money";

import {
  cancelWorkOrder,
  completeWorkOrder,
  createWorkOrder,
  fetchVehicleOptions,
  fetchWorkOrder,
  MAINTENANCE_KEY,
  startWorkOrder,
  TYPE_LABELS,
  updateWorkOrder,
  type WorkOrder,
} from "./api";
import { WorkOrderStatusBadge } from "./badges";
import { formatDay } from "./rows";
import {
  completionSchema,
  completionToPayload,
  type CompletionValues,
  workOrderSchema,
  workOrderToPayload,
  workOrderToValues,
  type WorkOrderValues,
} from "./schema";

function WorkOrderForm({
  order,
  vehicleId,
  scheduleId,
}: {
  order?: WorkOrder;
  vehicleId?: string;
  scheduleId?: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const vehicles = useQuery({
    queryKey: [...MAINTENANCE_KEY, "vehicle-options"],
    queryFn: fetchVehicleOptions,
    enabled: !order,
  });
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<WorkOrderValues>({
    resolver: zodResolver(workOrderSchema),
    defaultValues: order
      ? workOrderToValues(order)
      : {
          vehicle_id: vehicleId ?? "",
          work_type: scheduleId ? "preventive" : "corrective",
          title: "",
          description: "",
          scheduled_for: "",
          provider_name: "",
          provider_phone: "",
          provider_email: "",
        },
  });
  const { formError, clearFormError, handleApiError } = useApiFormError(setError, {});

  async function onSubmit(values: WorkOrderValues) {
    clearFormError();
    try {
      const saved = order
        ? await updateWorkOrder(order.id, workOrderToPayload(values))
        : await createWorkOrder({
            ...workOrderToPayload(values),
            vehicle_id: values.vehicle_id,
            work_type: values.work_type,
            ...(scheduleId ? { schedule_id: scheduleId } : {}),
          });
      await queryClient.invalidateQueries({ queryKey: MAINTENANCE_KEY });
      toast.success(order ? "Work order updated." : "Work order created.");
      router.push(`/maintenance/work-orders/${saved.id}`);
    } catch (error) {
      handleApiError(error);
    }
  }

  function text(
    name: keyof WorkOrderValues,
    label: string,
    options: { required?: boolean; type?: string } = {},
  ) {
    return (
      <Field id={name} label={label} required={options.required} error={errors[name]?.message}>
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
        {!order && (
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="vehicle_id" label="Vehicle" required error={errors.vehicle_id?.message}>
              {(describedBy) => (
                <SelectInput
                  // Remounted when options arrive: a select can't show a value it doesn't have yet.
                  key={vehicles.data ? "loaded" : "loading"}
                  id="vehicle_id"
                  // Booked from a schedule, the vehicle is already decided.
                  disabled={vehicles.isPending || Boolean(scheduleId)}
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
            <Field id="work_type" label="Type" required>
              {(describedBy) => (
                <SelectInput id="work_type" aria-describedby={describedBy} {...register("work_type")}>
                  <option value="corrective">Corrective: fixing a problem</option>
                  <option value="preventive">Preventive: routine service</option>
                </SelectInput>
              )}
            </Field>
          </div>
        )}
        {text("title", "Title", { required: true })}
        <Field id="description" label="Description" error={errors.description?.message}>
          {(describedBy) => (
            <TextArea id="description" rows={3} aria-describedby={describedBy} {...register("description")} />
          )}
        </Field>
        {text("scheduled_for", "Booked for", { type: "date" })}
        <fieldset className="flex flex-col gap-4">
          <legend className="mb-1 text-sm font-medium">Service provider</legend>
          <div className="grid gap-5 sm:grid-cols-3">
            {text("provider_name", "Provider name")}
            {text("provider_phone", "Provider phone", { type: "tel" })}
            {text("provider_email", "Provider email", { type: "email" })}
          </div>
        </fieldset>
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={isSubmitting || (!order && vehicles.isPending)}>
            {isSubmitting ? "Saving…" : order ? "Save changes" : "Create work order"}
          </Button>
          <Link
            href={order ? `/maintenance/work-orders/${order.id}` : "/maintenance"}
            className="btn btn-ghost font-medium"
          >
            Cancel
          </Link>
        </div>
      </form>
    </Card>
  );
}

export function NewWorkOrder() {
  const params = useSearchParams();
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <h1 className="text-3xl font-bold tracking-tight">New work order</h1>
      <WorkOrderForm
        vehicleId={params.get("vehicle") ?? undefined}
        scheduleId={params.get("schedule") ?? undefined}
      />
    </div>
  );
}

function useOrderFromRoute() {
  const { id } = useParams<{ id: string }>();
  return useQuery({
    queryKey: [...MAINTENANCE_KEY, "order", id],
    queryFn: () => fetchWorkOrder(id),
  });
}

function LoadState({ query }: { query: ReturnType<typeof useOrderFromRoute> }) {
  if (query.isPending) {
    return (
      <p role="status" className="text-sm opacity-75">
        Loading work order…
      </p>
    );
  }
  const missing = query.error instanceof ApiError && query.error.status === 404;
  return (
    <div className="flex flex-col items-start gap-3">
      <h1 className="text-3xl font-bold tracking-tight">
        {missing ? "Work order not found" : "Work order"}
      </h1>
      <Alert variant="error">
        {missing ? "This work order doesn't exist." : query.error?.message}
      </Alert>
      <ButtonLink href="/maintenance" variant="outline">
        Back to maintenance
      </ButtonLink>
    </div>
  );
}

function useRefresh() {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: MAINTENANCE_KEY });
    await queryClient.invalidateQueries({ queryKey: VEHICLES_KEY });
    await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };
}

function CompleteCard({
  order,
  unit,
  onCancel,
}: {
  order: WorkOrder;
  unit: DistanceUnit;
  onCancel: () => void;
}) {
  const refresh = useRefresh();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CompletionValues>({
    resolver: zodResolver(completionSchema),
    defaultValues: {
      completed_on: "",
      odometer: "",
      labour_cost: "",
      parts_cost: "",
      completion_notes: "",
    },
  });
  const { formError, clearFormError, handleApiError } = useApiFormError(setError, {
    odometer_required: "odometer",
    date_in_future: "completed_on",
  });

  async function onSubmit(values: CompletionValues) {
    clearFormError();
    try {
      await completeWorkOrder(order.id, completionToPayload(values, unit));
      toast.success("Work order completed.");
      await refresh();
    } catch (error) {
      handleApiError(error);
    }
  }

  function text(name: keyof CompletionValues, label: string, hint?: string, type = "text") {
    return (
      <Field id={name} label={label} hint={hint} error={errors[name]?.message}>
        {(describedBy) => (
          <TextInput
            id={name}
            type={type}
            inputMode={type === "text" ? "decimal" : undefined}
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
      <h2 className="text-lg font-semibold">Complete this work</h2>
      <form noValidate onSubmit={handleSubmit(onSubmit)} className="mt-3 flex flex-col gap-5">
        {formError && <Alert variant="error">{formError.message}</Alert>}
        <div className="grid gap-5 sm:grid-cols-2">
          {text("completed_on", "Completed on", "Blank means today.", "date")}
          {text(
            "odometer",
            `Odometer in ${unit}`,
            order.schedule_id ? "Needed if the schedule goes by distance." : undefined,
          )}
          {text("labour_cost", `Labour cost in ${order.currency}`, "Blank means not recorded.")}
          {text("parts_cost", `Parts cost in ${order.currency}`, "Blank means not recorded.")}
        </div>
        <Field id="completion_notes" label="What was done" error={errors.completion_notes?.message}>
          {(describedBy) => (
            <TextArea
              id="completion_notes"
              rows={3}
              aria-describedby={describedBy}
              {...register("completion_notes")}
            />
          )}
        </Field>
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : "Complete work order"}
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Not yet
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function WorkOrderDetail({ membership }: { membership: CurrentMembership }) {
  const query = useOrderFromRoute();
  const refresh = useRefresh();
  const [dialog, setDialog] = useState<"start" | "cancel" | null>(null);
  const [completing, setCompleting] = useState(false);
  const [takeOffRoad, setTakeOffRoad] = useState(true);
  const change = useMutation({
    mutationFn: ({ action }: { action: () => Promise<WorkOrder>; message: string }) => action(),
    onSuccess: async (_order, { message }) => {
      setDialog(null);
      toast.success(message);
      await refresh();
    },
    onError: (error) => {
      setDialog(null);
      toast.error(error.message);
    },
  });
  const order = query.data;
  if (!order) return <LoadState query={query} />;

  const unit = membership.organisation.distance_unit;
  const canManage = membership.permissions.includes("maintenance.manage");
  const unfinished = order.status === "open" || order.status === "in_progress";
  const rows: [string, React.ReactNode][] = [
    ["Vehicle", <Link key="vehicle" href={`/vehicles/${order.vehicle_id}`} className="link">{order.vehicle_registration}</Link>],
    ["Type", TYPE_LABELS[order.work_type]],
    ["Description", order.description ?? "None"],
    ["Booked for", order.scheduled_for ? formatDay(order.scheduled_for) : "Not booked"],
    ["Provider", order.provider_name ?? "Not recorded"],
    ...(order.provider_phone ? ([["Provider phone", order.provider_phone]] as [string, React.ReactNode][]) : []),
    ...(order.provider_email ? ([["Provider email", order.provider_email]] as [string, React.ReactNode][]) : []),
    ...(order.started_at
      ? ([["Started", `${format(new Date(order.started_at), "d MMM yyyy, HH:mm")}${order.took_off_road ? ", vehicle taken off the road" : ""}`]] as [string, React.ReactNode][])
      : []),
    ...(order.status === "completed"
      ? ([
          ["Completed", formatDay(order.completed_on!)],
          ["Odometer", order.odometer_km === null ? "Not recorded" : formatDistance(Number(order.odometer_km), unit)],
          ["Labour cost", formatMoney(order.labour_cost, order.currency)],
          ["Parts cost", formatMoney(order.parts_cost, order.currency)],
          ["Total cost", formatMoney(order.total_cost, order.currency)],
          ["What was done", order.completion_notes ?? "Not recorded"],
        ] as [string, React.ReactNode][])
      : []),
  ];

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Link href="/maintenance" className="link inline-flex items-center gap-1 text-sm">
        <ArrowLeft aria-hidden className="size-4" />
        Maintenance
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-bold tracking-tight">{order.title}</h1>
        <WorkOrderStatusBadge status={order.status} />
      </div>
      {canManage && unfinished && !completing && (
        <div className="flex flex-wrap gap-3">
          {order.status === "open" && <Button onClick={() => setDialog("start")}>Start work</Button>}
          {order.status === "in_progress" && (
            <Button onClick={() => setCompleting(true)}>Complete work</Button>
          )}
          <ButtonLink href={`/maintenance/work-orders/${order.id}/edit`} variant="outline">
            Edit
          </ButtonLink>
          <Button variant="ghost" onClick={() => setDialog("cancel")}>
            Cancel work order
          </Button>
        </div>
      )}
      {completing && order.status === "in_progress" && (
        <CompleteCard order={order} unit={unit} onCancel={() => setCompleting(false)} />
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
        open={dialog === "start"}
        title="Start this work?"
        confirmLabel="Start work"
        busy={change.isPending}
        onCancel={() => setDialog(null)}
        onConfirm={() =>
          change.mutate({
            action: () => startWorkOrder(order.id, takeOffRoad),
            message: "Work started.",
          })
        }
      >
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="checkbox checkbox-sm mt-0.5"
            checked={takeOffRoad}
            onChange={(event) => setTakeOffRoad(event.target.checked)}
          />
          Take the vehicle off the road. It can&apos;t be dispatched until the work ends.
        </label>
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === "cancel"}
        title="Cancel this work order?"
        confirmLabel="Cancel work order"
        busy={change.isPending}
        onCancel={() => setDialog(null)}
        onConfirm={() =>
          change.mutate({
            action: () => cancelWorkOrder(order.id),
            message: "Work order cancelled.",
          })
        }
      >
        This can&apos;t be undone. It stays in the history, and any schedule stays due.
      </ConfirmDialog>
    </div>
  );
}

export function EditWorkOrder() {
  const query = useOrderFromRoute();
  const order = query.data;
  if (!order) return <LoadState query={query} />;
  if (order.status === "completed" || order.status === "cancelled") {
    return (
      <div className="flex flex-col items-start gap-3">
        <h1 className="text-3xl font-bold tracking-tight">Edit work order</h1>
        <Alert variant="info">A finished work order can&apos;t be changed.</Alert>
      </div>
    );
  }
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <h1 className="text-3xl font-bold tracking-tight">Edit work order</h1>
      <WorkOrderForm order={order} />
    </div>
  );
}
