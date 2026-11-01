"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Alert } from "@/components/ui/alert";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, SelectInput, TextArea, TextInput } from "@/components/ui/field";
import { useApiFormError } from "@/features/auth/use-api-form-error";
import { ReceiptField } from "@/features/costs/receipt";

import {
  COMPLIANCE_KEY,
  type ComplianceDocument,
  createDocument,
  createTemplate,
  DOCUMENT_TYPES,
  fetchDocument,
  fetchOptions,
  fetchTemplate,
  type StoredFile,
  type Template,
  TYPE_LABELS,
  updateDocument,
  updateTemplate,
  uploadFile,
} from "./api";

const documentSchema = z
  .object({
    owner: z.string().min(1, "Please choose a vehicle or driver."),
    document_type: z.enum(DOCUMENT_TYPES),
    title: z.string().trim().min(1, "Please enter a title.").max(160),
    reference_number: z.string().trim().max(100),
    issued_on: z.string(),
    expires_on: z.string(),
    notes: z.string().trim().max(2000),
  })
  .refine((values) => !values.issued_on || !values.expires_on || values.expires_on >= values.issued_on, {
    path: ["expires_on"],
    message: "The expiry date must be after the issue date.",
  });
type DocumentValues = z.infer<typeof documentSchema>;

// Owners share one list, so each value says which kind it is.
const ownerValue = (document?: ComplianceDocument) =>
  document?.vehicle_id
    ? `vehicle:${document.vehicle_id}`
    : document?.driver_id
      ? `driver:${document.driver_id}`
      : "";

function DocumentForm({ document, initialOwner }: { document?: ComplianceDocument; initialOwner?: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const options = useQuery({
    queryKey: [...COMPLIANCE_KEY, "options"],
    queryFn: fetchOptions,
    enabled: !document,
  });
  const [file, setFile] = useState<StoredFile | null>(document?.file ?? null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<DocumentValues>({
    resolver: zodResolver(documentSchema),
    defaultValues: {
      owner: ownerValue(document) || initialOwner || "",
      document_type: document?.document_type ?? "insurance",
      title: document?.title ?? "",
      reference_number: document?.reference_number ?? "",
      issued_on: document?.issued_on ?? "",
      expires_on: document?.expires_on ?? "",
      notes: document?.notes ?? "",
    },
  });
  const { formError, clearFormError, handleApiError } = useApiFormError(setError, {
    expiry_before_issue: "expires_on",
  });

  async function onSubmit(values: DocumentValues) {
    clearFormError();
    try {
      const body = {
        document_type: values.document_type,
        title: values.title,
        reference_number: values.reference_number || null,
        issued_on: values.issued_on || null,
        expires_on: values.expires_on || null,
        notes: values.notes || null,
        file_id: file?.id ?? null,
      };
      if (document) {
        await updateDocument(document.id, body);
      } else {
        const [kind, id] = values.owner.split(":");
        await createDocument({ ...body, ...(kind === "driver" ? { driver_id: id } : { vehicle_id: id }) });
      }
      await queryClient.invalidateQueries({ queryKey: COMPLIANCE_KEY });
      toast.success(document ? "Document updated." : "Document added.");
      router.push("/compliance");
    } catch (error) {
      handleApiError(error);
    }
  }

  function text(name: keyof DocumentValues, label: string, options_: { required?: boolean; type?: string; hint?: string } = {}) {
    return (
      <Field id={name} label={label} required={options_.required} hint={options_.hint} error={errors[name]?.message}>
        {(describedBy) => (
          <TextInput
            id={name}
            type={options_.type ?? "text"}
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
        {options.isError && <Alert variant="error">Vehicles and drivers couldn&apos;t be loaded.</Alert>}
        {!document && (
          <Field id="owner" label="Belongs to" required error={errors.owner?.message}>
            {(describedBy) => (
              <SelectInput
                // Remounted when options arrive: a select can't show a value it doesn't have yet.
                key={options.data ? "loaded" : "loading"}
                id="owner"
                disabled={options.isPending}
                aria-invalid={errors.owner ? true : undefined}
                aria-describedby={describedBy}
                {...register("owner")}
              >
                <option value="">Choose a vehicle or driver</option>
                <optgroup label="Vehicles">
                  {options.data?.vehicles.map((item) => (
                    <option key={item.id} value={`vehicle:${item.id}`}>
                      {item.registration_number}
                    </option>
                  ))}
                </optgroup>
                {Boolean(options.data?.drivers.length) && (
                  <optgroup label="Drivers">
                    {options.data?.drivers.map((item) => (
                      <option key={item.id} value={`driver:${item.id}`}>
                        {item.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </SelectInput>
            )}
          </Field>
        )}
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="document_type" label="Type" required>
            {(describedBy) => (
              <SelectInput id="document_type" aria-describedby={describedBy} {...register("document_type")}>
                {DOCUMENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {TYPE_LABELS[type]}
                  </option>
                ))}
              </SelectInput>
            )}
          </Field>
          {text("title", "Title", { required: true })}
          {text("reference_number", "Reference number")}
          {text("issued_on", "Issued on", { type: "date" })}
          {text("expires_on", "Expires on", {
            type: "date",
            hint: "Reminders start 30 days before this date.",
          })}
        </div>
        <ReceiptField
          label="File"
          value={file}
          onChange={setFile}
          upload={(picked) => uploadFile(picked, "document")}
        />
        <Field id="notes" label="Notes" error={errors.notes?.message}>
          {(describedBy) => <TextArea id="notes" rows={2} aria-describedby={describedBy} {...register("notes")} />}
        </Field>
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : document ? "Save changes" : "Add document"}
          </Button>
          <Link href="/compliance" className="btn btn-ghost font-medium">
            Cancel
          </Link>
        </div>
      </form>
    </Card>
  );
}

const templateSchema = z.object({
  name: z.string().trim().min(1, "Please enter a name.").max(120),
  items: z
    .array(
      z.object({
        id: z.string().optional(),
        label: z.string().trim().min(1, "Please describe this check.").max(200),
        critical: z.boolean(),
      }),
    )
    .min(1, "Add at least one check."),
});
type TemplateValues = z.infer<typeof templateSchema>;

function TemplateForm({ template }: { template?: Template }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const {
    control,
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<TemplateValues>({
    resolver: zodResolver(templateSchema),
    defaultValues: template
      ? { name: template.name, items: template.items }
      : { name: "", items: [{ label: "", critical: false }] },
  });
  const { fields, append, remove } = useFieldArray({ control, name: "items", keyName: "key" });
  const { formError, clearFormError, handleApiError } = useApiFormError(setError, {
    duplicate_name: "name",
  });

  async function onSubmit(values: TemplateValues) {
    clearFormError();
    try {
      if (template) await updateTemplate(template.id, values);
      else await createTemplate(values);
      await queryClient.invalidateQueries({ queryKey: COMPLIANCE_KEY });
      toast.success(template ? "Template updated." : "Template created.");
      router.push("/compliance");
    } catch (error) {
      handleApiError(error);
    }
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
        <fieldset className="flex flex-col gap-4">
          <legend className="mb-1 text-sm font-medium">Checks</legend>
          <p className="text-xs opacity-75">
            When a critical check fails, the vehicle can&apos;t be dispatched until the defect is fixed.
          </p>
          {typeof errors.items?.message === "string" && (
            <p className="text-sm text-error">{errors.items.message}</p>
          )}
          {fields.map((field, index) => (
            <div key={field.key} className="flex flex-wrap items-start gap-3 rounded-box border border-base-300 p-3">
              <div className="min-w-48 flex-1">
                <Field id={`item-${index}`} label={`Check ${index + 1}`} required error={errors.items?.[index]?.label?.message}>
                  {(describedBy) => (
                    <TextInput
                      id={`item-${index}`}
                      autoComplete="off"
                      aria-invalid={errors.items?.[index]?.label ? true : undefined}
                      aria-describedby={describedBy}
                      {...register(`items.${index}.label`)}
                    />
                  )}
                </Field>
              </div>
              <label className="mt-7 flex items-center gap-2 text-sm">
                <input type="checkbox" className="checkbox checkbox-sm" {...register(`items.${index}.critical`)} />
                Critical
              </label>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-square mt-6"
                aria-label={`Remove check ${index + 1}`}
                onClick={() => remove(index)}
              >
                <Trash2 aria-hidden className="size-4" />
              </button>
            </div>
          ))}
          <div>
            <Button variant="outline" onClick={() => append({ label: "", critical: false })}>
              <Plus aria-hidden className="size-4" />
              Add a check
            </Button>
          </div>
        </fieldset>
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : template ? "Save changes" : "Create template"}
          </Button>
          <Link href="/compliance" className="btn btn-ghost font-medium">
            Cancel
          </Link>
        </div>
      </form>
    </Card>
  );
}

const Wrapper = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="flex max-w-3xl flex-col gap-6">
    <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
    {children}
  </div>
);

function Failure({ title, message }: { title: string; message?: string }) {
  return (
    <div className="flex flex-col items-start gap-3">
      <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
      <Alert variant="error">{message ?? "This record couldn't be loaded."}</Alert>
      <ButtonLink href="/compliance" variant="outline">
        Back to compliance
      </ButtonLink>
    </div>
  );
}

export function NewDocument() {
  const params = useSearchParams();
  const vehicle = params.get("vehicle");
  const driver = params.get("driver");
  return (
    <Wrapper title="Add a document">
      <DocumentForm initialOwner={vehicle ? `vehicle:${vehicle}` : driver ? `driver:${driver}` : undefined} />
    </Wrapper>
  );
}

export function EditDocument() {
  const { id } = useParams<{ id: string }>();
  const query = useQuery({ queryKey: [...COMPLIANCE_KEY, "document", id], queryFn: () => fetchDocument(id) });
  if (query.isPending) return <p role="status" className="text-sm opacity-75">Loading…</p>;
  if (!query.data) return <Failure title="Document" message={query.error?.message} />;
  if (query.data.archived_at) return <Failure title="Document" message="An archived document can't be changed." />;
  return (
    <Wrapper title="Edit document">
      <DocumentForm document={query.data} />
    </Wrapper>
  );
}

export function NewTemplate() {
  return (
    <Wrapper title="New inspection template">
      <TemplateForm />
    </Wrapper>
  );
}

export function EditTemplate() {
  const { id } = useParams<{ id: string }>();
  const query = useQuery({ queryKey: [...COMPLIANCE_KEY, "template", id], queryFn: () => fetchTemplate(id) });
  if (query.isPending) return <p role="status" className="text-sm opacity-75">Loading…</p>;
  if (!query.data) return <Failure title="Template" message={query.error?.message} />;
  if (query.data.archived_at) return <Failure title="Template" message="An archived template can't be changed." />;
  return (
    <Wrapper title="Edit template">
      <p className="text-sm opacity-75">Past inspections keep the checks they were done with.</p>
      <TemplateForm template={query.data} />
    </Wrapper>
  );
}
