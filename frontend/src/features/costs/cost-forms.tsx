"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { type FieldValues, type Path, type UseFormRegister, useForm } from "react-hook-form";
import { toast } from "sonner";

import { Alert } from "@/components/ui/alert";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, SelectInput, TextArea, TextInput } from "@/components/ui/field";
import { useApiFormError } from "@/features/auth/use-api-form-error";
import type { CurrentMembership } from "@/features/organisation/api";
import { ApiError } from "@/lib/api/client";
import type { DistanceUnit } from "@/lib/distance";

import {
  CATEGORIES,
  CATEGORY_LABELS,
  COSTS_KEY,
  createExpense,
  createFuel,
  type Expense,
  fetchExpense,
  fetchFuelEntry,
  fetchOptions,
  type FuelEntry,
  type StoredFile,
  updateExpense,
  updateFuel,
} from "./api";
import { ReceiptField } from "./receipt";
import {
  expenseSchema,
  expenseToPayload,
  expenseToValues,
  type ExpenseValues,
  fuelSchema,
  fuelToPayload,
  fuelToValues,
  type FuelValues,
  nowForInput,
  todayForInput,
} from "./schema";

function VehicleSelect<T extends FieldValues>({
  register,
  error,
  disabled,
  loaded,
  vehicles,
}: {
  register: UseFormRegister<T>;
  error?: string;
  disabled: boolean;
  loaded: boolean;
  vehicles: { id: string; registration_number: string; make: string; model: string }[];
}) {
  return (
    <Field
      id="vehicle_id"
      label="Vehicle"
      required
      error={error}
      hint={loaded && vehicles.length === 0 ? "No vehicle is assigned to you yet." : undefined}
    >
      {(describedBy) => (
        <SelectInput
          // Remounted when options arrive: a select can't show a value it doesn't have yet.
          key={loaded ? "loaded" : "loading"}
          id="vehicle_id"
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...register("vehicle_id" as Path<T>)}
        >
          <option value="">Choose a vehicle</option>
          {vehicles.map((item) => (
            <option key={item.id} value={item.id}>
              {item.registration_number} · {item.make} {item.model}
            </option>
          ))}
        </SelectInput>
      )}
    </Field>
  );
}

function FuelForm({ entry, unit, vehicleId }: { entry?: FuelEntry; unit: DistanceUnit; vehicleId?: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const options = useQuery({ queryKey: [...COSTS_KEY, "options"], queryFn: fetchOptions });
  const [receipt, setReceipt] = useState<StoredFile | null>(entry?.receipt ?? null);
  // Fixed when the form opens, so a new minute can't count as a change to the form's values.
  const [openedAt] = useState(nowForInput);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FuelValues>({
    resolver: zodResolver(fuelSchema),
    values: entry
      ? fuelToValues(entry, unit)
      : {
          vehicle_id: vehicleId ?? "",
          filled_at: openedAt,
          quantity: "",
          unit: "litres",
          unit_price: "",
          currency: options.data?.default_currency ?? "",
          odometer: "",
          is_full_tank: false,
          station_name: "",
          notes: "",
        },
    resetOptions: { keepDirtyValues: true },
  });
  const { formError, clearFormError, handleApiError } = useApiFormError(setError, {
    date_in_future: "filled_at",
    vehicle_not_found: "vehicle_id",
  });

  async function onSubmit(values: FuelValues) {
    clearFormError();
    try {
      const payload = { ...fuelToPayload(values, unit), receipt_file_id: receipt?.id ?? null };
      if (entry) await updateFuel(entry.id, payload);
      else await createFuel({ ...payload, vehicle_id: values.vehicle_id });
      await queryClient.invalidateQueries({ queryKey: COSTS_KEY });
      toast.success(entry ? "Fuel record updated." : "Fuel record added.");
      router.push("/costs");
    } catch (error) {
      handleApiError(error);
    }
  }

  function text(
    name: keyof FuelValues,
    label: string,
    options_: { required?: boolean; type?: string; hint?: string; numeric?: boolean } = {},
  ) {
    return (
      <Field id={name} label={label} required={options_.required} hint={options_.hint} error={errors[name]?.message}>
        {(describedBy) => (
          <TextInput
            id={name}
            type={options_.type ?? "text"}
            inputMode={options_.numeric ? "decimal" : undefined}
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
        {options.isError && <Alert variant="error">Vehicles couldn&apos;t be loaded.</Alert>}
        {!entry && (
          <VehicleSelect
            register={register}
            error={errors.vehicle_id?.message}
            disabled={options.isPending}
            loaded={Boolean(options.data)}
            vehicles={options.data?.vehicles ?? []}
          />
        )}
        <div className="grid gap-5 sm:grid-cols-2">
          {text("filled_at", "Date and time", { required: true, type: "datetime-local" })}
          {text("station_name", "Fuel station")}
          {text("quantity", "Quantity", { required: true, numeric: true })}
          <Field id="unit" label="Unit" required>
            {(describedBy) => (
              <SelectInput id="unit" aria-describedby={describedBy} {...register("unit")}>
                <option value="litres">Litres</option>
                <option value="kwh">kWh (electric charging)</option>
              </SelectInput>
            )}
          </Field>
          {text("unit_price", "Price per unit", { required: true, numeric: true })}
          {text("currency", "Currency", { required: true })}
          {text("odometer", `Odometer in ${unit}`, {
            numeric: true,
            hint: "Needed to work out cost per distance and consumption.",
          })}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="checkbox checkbox-sm" {...register("is_full_tank")} />
          Filled to full. Consumption is measured between two full fills.
        </label>
        <ReceiptField value={receipt} onChange={setReceipt} />
        <Field id="notes" label="Notes" error={errors.notes?.message}>
          {(describedBy) => <TextArea id="notes" rows={2} aria-describedby={describedBy} {...register("notes")} />}
        </Field>
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : entry ? "Save changes" : "Add fuel record"}
          </Button>
          <Link href="/costs" className="btn btn-ghost font-medium">
            Cancel
          </Link>
        </div>
      </form>
    </Card>
  );
}

function ExpenseForm({ expense, vehicleId }: { expense?: Expense; vehicleId?: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const options = useQuery({ queryKey: [...COSTS_KEY, "options"], queryFn: fetchOptions });
  const [receipt, setReceipt] = useState<StoredFile | null>(expense?.receipt ?? null);
  const [openedOn] = useState(todayForInput);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ExpenseValues>({
    resolver: zodResolver(expenseSchema),
    values: expense
      ? expenseToValues(expense)
      : {
          vehicle_id: vehicleId ?? "",
          category: "tolls",
          amount: "",
          currency: options.data?.default_currency ?? "",
          incurred_on: openedOn,
          vendor: "",
          description: "",
        },
    resetOptions: { keepDirtyValues: true },
  });
  const { formError, clearFormError, handleApiError } = useApiFormError(setError, {
    date_in_future: "incurred_on",
    vehicle_not_found: "vehicle_id",
  });

  async function onSubmit(values: ExpenseValues) {
    clearFormError();
    try {
      const payload = { ...expenseToPayload(values), receipt_file_id: receipt?.id ?? null };
      if (expense) await updateExpense(expense.id, payload);
      else await createExpense({ ...payload, vehicle_id: values.vehicle_id });
      await queryClient.invalidateQueries({ queryKey: COSTS_KEY });
      toast.success(expense ? "Expense updated." : "Expense submitted.");
      router.push("/costs");
    } catch (error) {
      handleApiError(error);
    }
  }

  function text(
    name: keyof ExpenseValues,
    label: string,
    options_: { required?: boolean; type?: string; numeric?: boolean } = {},
  ) {
    return (
      <Field id={name} label={label} required={options_.required} error={errors[name]?.message}>
        {(describedBy) => (
          <TextInput
            id={name}
            type={options_.type ?? "text"}
            inputMode={options_.numeric ? "decimal" : undefined}
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
        {options.isError && <Alert variant="error">Vehicles couldn&apos;t be loaded.</Alert>}
        {expense?.status === "rejected" && (
          <Alert variant="info">
            Rejected: {expense.review_note}. Saving sends it for approval again.
          </Alert>
        )}
        {!expense && (
          <VehicleSelect
            register={register}
            error={errors.vehicle_id?.message}
            disabled={options.isPending}
            loaded={Boolean(options.data)}
            vehicles={options.data?.vehicles ?? []}
          />
        )}
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="category" label="Category" required>
            {(describedBy) => (
              <SelectInput id="category" aria-describedby={describedBy} {...register("category")}>
                {CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {CATEGORY_LABELS[category]}
                  </option>
                ))}
              </SelectInput>
            )}
          </Field>
          {text("incurred_on", "Date", { required: true, type: "date" })}
          {text("amount", "Amount", { required: true, numeric: true })}
          {text("currency", "Currency", { required: true })}
          {text("vendor", "Paid to")}
        </div>
        <ReceiptField value={receipt} onChange={setReceipt} />
        <Field id="description" label="Description" error={errors.description?.message}>
          {(describedBy) => (
            <TextArea id="description" rows={2} aria-describedby={describedBy} {...register("description")} />
          )}
        </Field>
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : expense ? "Save changes" : "Submit expense"}
          </Button>
          <Link href="/costs" className="btn btn-ghost font-medium">
            Cancel
          </Link>
        </div>
      </form>
    </Card>
  );
}

function LoadFailure({ error, title }: { error: Error | null; title: string }) {
  const missing = error instanceof ApiError && error.status === 404;
  return (
    <div className="flex flex-col items-start gap-3">
      <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
      <Alert variant="error">{missing ? "This record wasn't found." : error?.message}</Alert>
      <ButtonLink href="/costs" variant="outline">
        Back to fuel and expenses
      </ButtonLink>
    </div>
  );
}

const Wrapper = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="flex max-w-3xl flex-col gap-6">
    <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
    {children}
  </div>
);

export function NewFuel({ membership }: { membership: CurrentMembership }) {
  const vehicleId = useSearchParams().get("vehicle") ?? undefined;
  return (
    <Wrapper title="Add a fuel record">
      <FuelForm unit={membership.organisation.distance_unit} vehicleId={vehicleId} />
    </Wrapper>
  );
}

export function EditFuel({ membership }: { membership: CurrentMembership }) {
  const { id } = useParams<{ id: string }>();
  const query = useQuery({ queryKey: [...COSTS_KEY, "fuel", id], queryFn: () => fetchFuelEntry(id) });
  if (query.isPending) return <p role="status" className="text-sm opacity-75">Loading…</p>;
  if (!query.data) return <LoadFailure error={query.error} title="Fuel record" />;
  if (query.data.voided_at) return <LoadFailure error={new Error("A voided record can't be changed.")} title="Fuel record" />;
  return (
    <Wrapper title="Edit fuel record">
      <FuelForm entry={query.data} unit={membership.organisation.distance_unit} />
    </Wrapper>
  );
}

export function NewExpense() {
  const vehicleId = useSearchParams().get("vehicle") ?? undefined;
  return (
    <Wrapper title="Submit an expense">
      <ExpenseForm vehicleId={vehicleId} />
    </Wrapper>
  );
}

export function EditExpense() {
  const { id } = useParams<{ id: string }>();
  const query = useQuery({ queryKey: [...COSTS_KEY, "expense", id], queryFn: () => fetchExpense(id) });
  if (query.isPending) return <p role="status" className="text-sm opacity-75">Loading…</p>;
  if (!query.data) return <LoadFailure error={query.error} title="Expense" />;
  if (query.data.status === "approved" || query.data.voided_at) {
    return <LoadFailure error={new Error("An approved or voided expense can't be changed.")} title="Expense" />;
  }
  return (
    <Wrapper title="Edit expense">
      <ExpenseForm expense={query.data} />
    </Wrapper>
  );
}
