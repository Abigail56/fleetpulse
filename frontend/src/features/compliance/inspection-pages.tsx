"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Alert } from "@/components/ui/alert";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, SelectInput, TextArea, TextInput } from "@/components/ui/field";
import { StatusBadge } from "@/components/ui/status-badge";
import { useApiFormError } from "@/features/auth/use-api-form-error";
import { ReceiptField } from "@/features/costs/receipt";
import type { CurrentMembership } from "@/features/organisation/api";
import { type DistanceUnit, formatDistance, toKm } from "@/lib/distance";
import { ApiError } from "@/lib/api/client";

import {
  COMPLIANCE_KEY,
  createDefect,
  createInspection,
  fetchInspection,
  fetchOptions,
  fetchTemplates,
  type ItemResult,
  RESULT_LABELS,
  type Severity,
  SEVERITY_LABELS,
  type StoredFile,
  type Template,
  uploadFile,
} from "./api";

const RESULTS: ItemResult[] = ["pass", "fail", "not_applicable"];

/** Results start unanswered: a skipped safety check must never default to a pass. */
function Checklist({
  vehicleId,
  template,
  unit,
}: {
  vehicleId: string;
  template: Template;
  unit: DistanceUnit;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [answers, setAnswers] = useState<Record<string, ItemResult>>({});
  const [itemNotes, setItemNotes] = useState<Record<string, string>>({});
  const [odometer, setOdometer] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const missing = template.items.filter((item) => !answers[item.id]).length;
  const failedCritical = template.items.some(
    (item) => item.critical && answers[item.id] === "fail",
  );

  async function submit() {
    if (missing > 0) {
      setError(`Answer every check. ${missing} still to do.`);
      return;
    }
    if (odometer && !(Number(odometer) >= 0)) {
      setError("The odometer must be a number.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const saved = await createInspection({
        vehicle_id: vehicleId,
        template_id: template.id,
        ...(odometer ? { odometer_km: toKm(Number(odometer), unit).toFixed(1) } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        answers: template.items.map((item) => ({
          item_id: item.id,
          result: answers[item.id],
          ...(itemNotes[item.id]?.trim() ? { note: itemNotes[item.id].trim() } : {}),
        })),
      });
      await queryClient.invalidateQueries({ queryKey: COMPLIANCE_KEY });
      toast.success("Inspection saved.");
      router.push(`/compliance/inspections/${saved.id}`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The inspection couldn't be saved.");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {template.items.map((item) => (
        <fieldset key={item.id} className="rounded-box border border-base-300 p-3">
          <legend className="px-1 text-sm font-medium">
            {item.label}
            {item.critical && <span className="ml-2 text-xs font-normal">(critical)</span>}
          </legend>
          <div className="flex flex-wrap gap-4 text-sm">
            {RESULTS.map((result) => (
              <label key={result} className="flex items-center gap-2">
                <input
                  type="radio"
                  className="radio radio-sm"
                  name={`item-${item.id}`}
                  checked={answers[item.id] === result}
                  onChange={() => setAnswers({ ...answers, [item.id]: result })}
                />
                {RESULT_LABELS[result]}
              </label>
            ))}
          </div>
          {answers[item.id] === "fail" && (
            <label className="mt-2 flex flex-col gap-1 text-sm">
              What&apos;s wrong
              <TextInput
                maxLength={500}
                value={itemNotes[item.id] ?? ""}
                onChange={(event) => setItemNotes({ ...itemNotes, [item.id]: event.target.value })}
              />
            </label>
          )}
        </fieldset>
      ))}
      {failedCritical && (
        <Alert variant="error">
          A critical check failed. This vehicle can&apos;t be dispatched until the defect is fixed.
        </Alert>
      )}
      <label className="flex flex-col gap-1 text-sm">
        Odometer in {unit} (optional)
        <TextInput inputMode="decimal" value={odometer} onChange={(event) => setOdometer(event.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Notes (optional)
        <TextArea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </label>
      {error && <Alert variant="error">{error}</Alert>}
      <div className="flex flex-wrap gap-3">
        <Button disabled={busy} onClick={() => void submit()}>
          {busy ? "Saving…" : "Save inspection"}
        </Button>
        <Link href="/compliance" className="btn btn-ghost font-medium">
          Cancel
        </Link>
      </div>
    </div>
  );
}

export function NewInspection({ membership }: { membership: CurrentMembership }) {
  const initialVehicle = useSearchParams().get("vehicle") ?? "";
  const options = useQuery({ queryKey: [...COMPLIANCE_KEY, "options"], queryFn: fetchOptions });
  const templates = useQuery({ queryKey: [...COMPLIANCE_KEY, "templates"], queryFn: fetchTemplates });
  const [vehicleId, setVehicleId] = useState(initialVehicle);
  const [templateId, setTemplateId] = useState("");
  const vehicles = options.data?.vehicles ?? [];
  // A driver with one vehicle has nothing to choose.
  const chosenVehicle = vehicleId || (vehicles.length === 1 ? vehicles[0].id : "");
  const template = templates.data?.find((item) => item.id === templateId);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <h1 className="text-3xl font-bold tracking-tight">New inspection</h1>
      {(options.isError || templates.isError) && (
        <Alert variant="error">{options.error?.message ?? templates.error?.message}</Alert>
      )}
      {options.data && vehicles.length === 0 && (
        <Alert variant="info">No vehicle is available to inspect. Ask your fleet manager to assign you one.</Alert>
      )}
      {templates.data?.length === 0 && (
        <Alert variant="info">
          No inspection templates exist yet.
          {membership.permissions.includes("compliance.manage") && (
            <>
              {" "}
              <Link href="/compliance/templates/new" className="link">
                Create one first
              </Link>
              .
            </>
          )}
        </Alert>
      )}
      <Card>
        <div className="flex flex-col gap-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Vehicle
              <SelectInput
                value={chosenVehicle}
                disabled={options.isPending}
                onChange={(event) => setVehicleId(event.target.value)}
              >
                <option value="">Choose a vehicle</option>
                {vehicles.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.registration_number} · {item.make} {item.model}
                  </option>
                ))}
              </SelectInput>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Template
              <SelectInput
                value={templateId}
                disabled={templates.isPending}
                onChange={(event) => setTemplateId(event.target.value)}
              >
                <option value="">Choose a template</option>
                {templates.data?.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </SelectInput>
            </label>
          </div>
          {chosenVehicle && template && (
            <Checklist
              key={`${chosenVehicle}-${template.id}`}
              vehicleId={chosenVehicle}
              template={template}
              unit={membership.organisation.distance_unit}
            />
          )}
        </div>
      </Card>
    </div>
  );
}

export function InspectionDetail({ membership }: { membership: CurrentMembership }) {
  const { id } = useParams<{ id: string }>();
  const query = useQuery({
    queryKey: [...COMPLIANCE_KEY, "inspection", id],
    queryFn: () => fetchInspection(id),
  });
  if (query.isPending) return <p role="status" className="text-sm opacity-75">Loading inspection…</p>;
  const inspection = query.data;
  if (!inspection) {
    const missing = query.error instanceof ApiError && query.error.status === 404;
    return (
      <div className="flex flex-col items-start gap-3">
        <h1 className="text-3xl font-bold tracking-tight">Inspection</h1>
        <Alert variant="error">{missing ? "This inspection wasn't found." : query.error?.message}</Alert>
        <ButtonLink href="/compliance" variant="outline">
          Back to compliance
        </ButtonLink>
      </div>
    );
  }
  const unit = membership.organisation.distance_unit;
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Link href="/compliance" className="link inline-flex items-center gap-1 text-sm">
        <ArrowLeft aria-hidden className="size-4" />
        Compliance
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-bold tracking-tight">
          {inspection.vehicle_registration} · {inspection.template_name}
        </h1>
        <StatusBadge status={inspection.outcome === "passed" ? "success" : "error"}>
          {inspection.outcome === "passed" ? "Passed" : "Failed"}
        </StatusBadge>
      </div>
      <p className="text-sm opacity-75">
        {format(new Date(inspection.performed_at), "d MMM yyyy, HH:mm")}
        {inspection.performed_by_name && ` by ${inspection.performed_by_name}`}
        {inspection.odometer_km !== null && ` · ${formatDistance(Number(inspection.odometer_km), unit)}`}
      </p>
      <Card>
        <h2 className="text-lg font-semibold">Results</h2>
        <ul aria-label="Results" className="mt-3 divide-y divide-base-300 border-y border-base-300 text-sm">
          {inspection.results.map((item) => (
            <li key={item.label} className="py-2.5">
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {item.label}
                  {item.critical && <span className="ml-2 text-xs opacity-75">(critical)</span>}
                </span>
                <StatusBadge
                  status={item.result === "pass" ? "success" : item.result === "fail" ? "error" : "neutral"}
                >
                  {RESULT_LABELS[item.result]}
                </StatusBadge>
              </span>
              {item.note && <span className="mt-1 block text-xs opacity-85">{item.note}</span>}
            </li>
          ))}
        </ul>
        {inspection.notes && <p className="mt-3 text-sm">{inspection.notes}</p>}
      </Card>
    </div>
  );
}

const defectSchema = z.object({
  vehicle_id: z.string().min(1, "Please choose a vehicle."),
  title: z.string().trim().min(1, "Please say what's wrong.").max(160),
  severity: z.enum(["minor", "major", "critical"]),
  description: z.string().trim().max(2000),
});
type DefectValues = z.infer<typeof defectSchema>;

export function NewDefect() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const initialVehicle = useSearchParams().get("vehicle") ?? "";
  const options = useQuery({ queryKey: [...COMPLIANCE_KEY, "options"], queryFn: fetchOptions });
  const [photo, setPhoto] = useState<StoredFile | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<DefectValues>({
    resolver: zodResolver(defectSchema),
    defaultValues: { vehicle_id: initialVehicle, title: "", severity: "minor", description: "" },
  });
  const { formError, clearFormError, handleApiError } = useApiFormError(setError, {
    vehicle_not_found: "vehicle_id",
  });

  async function onSubmit(values: DefectValues) {
    clearFormError();
    try {
      await createDefect({
        vehicle_id: values.vehicle_id,
        title: values.title,
        severity: values.severity,
        ...(values.description ? { description: values.description } : {}),
        ...(photo ? { photo_file_id: photo.id } : {}),
      });
      await queryClient.invalidateQueries({ queryKey: COMPLIANCE_KEY });
      toast.success("Defect reported.");
      router.push("/compliance");
    } catch (error) {
      handleApiError(error);
    }
  }

  const levels: Severity[] = ["minor", "major", "critical"];
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <h1 className="text-3xl font-bold tracking-tight">Report a defect</h1>
      <Card>
        <form noValidate onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
          {formError && <Alert variant="error">{formError.message}</Alert>}
          {options.isError && <Alert variant="error">Vehicles couldn&apos;t be loaded.</Alert>}
          <Field
            id="vehicle_id"
            label="Vehicle"
            required
            error={errors.vehicle_id?.message}
            hint={options.data?.vehicles.length === 0 ? "No vehicle is assigned to you yet." : undefined}
          >
            {(describedBy) => (
              <SelectInput
                // Remounted when options arrive: a select can't show a value it doesn't have yet.
                key={options.data ? "loaded" : "loading"}
                id="vehicle_id"
                disabled={options.isPending}
                aria-invalid={errors.vehicle_id ? true : undefined}
                aria-describedby={describedBy}
                {...register("vehicle_id")}
              >
                <option value="">Choose a vehicle</option>
                {options.data?.vehicles.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.registration_number} · {item.make} {item.model}
                  </option>
                ))}
              </SelectInput>
            )}
          </Field>
          <Field id="title" label="What's wrong" required error={errors.title?.message}>
            {(describedBy) => (
              <TextInput
                id="title"
                autoComplete="off"
                aria-invalid={errors.title ? true : undefined}
                aria-describedby={describedBy}
                {...register("title")}
              />
            )}
          </Field>
          <Field
            id="severity"
            label="Severity"
            required
            hint="A critical defect stops the vehicle being dispatched until it's fixed."
          >
            {(describedBy) => (
              <SelectInput id="severity" aria-describedby={describedBy} {...register("severity")}>
                {levels.map((level) => (
                  <option key={level} value={level}>
                    {SEVERITY_LABELS[level]}
                  </option>
                ))}
              </SelectInput>
            )}
          </Field>
          <Field id="description" label="Details" error={errors.description?.message}>
            {(describedBy) => (
              <TextArea id="description" rows={3} aria-describedby={describedBy} {...register("description")} />
            )}
          </Field>
          <ReceiptField
            label="Photo"
            value={photo}
            onChange={setPhoto}
            upload={(picked) => uploadFile(picked, "inspection")}
          />
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Report defect"}
            </Button>
            <Link href="/compliance" className="btn btn-ghost font-medium">
              Cancel
            </Link>
          </div>
        </form>
      </Card>
    </div>
  );
}
