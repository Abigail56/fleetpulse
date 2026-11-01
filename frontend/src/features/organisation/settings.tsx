"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useApiFormError } from "@/features/auth/use-api-form-error";
import { changeSession } from "@/lib/session-change";

import { type CurrentMembership, leaveOrganisation, updateOrganisation } from "./api";
import { OrganisationFields } from "./organisation-fields";
import { ROLE_LABELS } from "./roles";
import { type OrganisationValues, organisationSchema } from "./schemas";

function EditForm({ membership }: { membership: CurrentMembership }) {
  const queryClient = useQueryClient();
  const { organisation } = membership;
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<OrganisationValues>({
    resolver: zodResolver(organisationSchema),
    defaultValues: {
      name: organisation.name,
      country_code: organisation.country_code,
      default_currency: organisation.default_currency,
      timezone: organisation.timezone,
      distance_unit: organisation.distance_unit,
    },
  });
  const { formError, clearFormError, handleApiError } = useApiFormError(setError);

  return (
    <form
      noValidate
      className="mt-5 flex flex-col gap-4"
      onSubmit={handleSubmit(async (values) => {
        clearFormError();
        try {
          await updateOrganisation(values);
          await queryClient.invalidateQueries({ queryKey: ["organisation"] });
          toast.success("Organisation details saved.");
        } catch (error) {
          handleApiError(error);
        }
      })}
    >
      {formError && <Alert variant="error">{formError.message}</Alert>}
      <OrganisationFields
        register={register}
        errors={errors}
        currentTimezone={organisation.timezone}
      />
      <div>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

function ReadOnlyDetails({ membership }: { membership: CurrentMembership }) {
  const { organisation } = membership;
  const rows = [
    ["Name", organisation.name],
    ["Country code", organisation.country_code],
    ["Default currency", organisation.default_currency],
    ["Time zone", organisation.timezone],
    ["Distance unit", organisation.distance_unit === "km" ? "Kilometres" : "Miles"],
  ];
  return (
    <dl className="mt-4 divide-y divide-base-300 border-y border-base-300">
      {rows.map(([label, value]) => (
        <div key={label} className="grid gap-1 py-3 sm:grid-cols-2">
          <dt className="text-sm font-medium">{label}</dt>
          <dd className="text-sm">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function OrganisationSettings({ membership }: { membership: CurrentMembership }) {
  const [confirmLeave, setConfirmLeave] = useState(false);
  const leave = useMutation({
    mutationFn: leaveOrganisation,
    onSuccess: () => changeSession("/onboarding"),
    onError: (error) => {
      setConfirmLeave(false);
      toast.error(error.message);
    },
  });
  const canManage = membership.permissions.includes("organisation.manage");

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <h1 className="text-3xl font-bold tracking-tight">Organisation</h1>
      <Card>
        <h2 className="text-lg font-semibold">Details</h2>
        {canManage ? (
          <EditForm key={membership.organisation.id} membership={membership} />
        ) : (
          <ReadOnlyDetails membership={membership} />
        )}
      </Card>
      <Card>
        <h2 className="text-lg font-semibold">Leave this organisation</h2>
        <p className="mt-1 text-sm opacity-75">
          You&apos;re a member as {ROLE_LABELS[membership.role]}. You&apos;ll lose access unless
          someone invites you again.
        </p>
        <Button variant="outline" className="mt-4" onClick={() => setConfirmLeave(true)}>
          Leave organisation
        </Button>
      </Card>
      <ConfirmDialog
        open={confirmLeave}
        title={`Leave ${membership.organisation.name}?`}
        confirmLabel="Leave organisation"
        busy={leave.isPending}
        onConfirm={() => leave.mutate()}
        onCancel={() => setConfirmLeave(false)}
      >
        You&apos;ll lose access straight away.
      </ConfirmDialog>
    </div>
  );
}
