"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useApiFormError } from "@/features/auth/use-api-form-error";
import { changeSession } from "@/lib/session-change";

import { createOrganisation, fetchMine, KEYS, switchOrganisation } from "./api";
import { OrganisationFields } from "./organisation-fields";
import { ROLE_LABELS } from "./roles";
import { type OrganisationValues, organisationSchema } from "./schemas";

export function Onboarding() {
  const mine = useQuery({ queryKey: KEYS.mine, queryFn: fetchMine });
  const [browserZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<OrganisationValues>({
    resolver: zodResolver(organisationSchema),
    defaultValues: {
      name: "",
      country_code: "",
      default_currency: "",
      timezone: browserZone,
      distance_unit: "km",
    },
  });
  const { formError, clearFormError, handleApiError } = useApiFormError(setError);
  const open = useMutation({
    mutationFn: switchOrganisation,
    onSuccess: () => changeSession("/dashboard"),
    onError: (error) => toast.error(error.message),
  });
  const organisations = mine.data ?? [];

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          {organisations.length > 0 ? "Choose an organisation" : "Set up your organisation"}
        </h1>
        <p className="mt-1 opacity-75">
          Vehicles, drivers and trips belong to an organisation, and each one&apos;s data is kept
          separate.
        </p>
      </div>
      {mine.isError && <Alert variant="error">{mine.error.message}</Alert>}
      {organisations.length > 0 && (
        <Card>
          <h2 className="text-lg font-semibold">Your organisations</h2>
          <ul className="mt-3 divide-y divide-base-300 border-y border-base-300">
            {organisations.map(({ organisation, role }) => (
              <li key={organisation.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{organisation.name}</p>
                  <p className="text-sm opacity-70">{ROLE_LABELS[role]}</p>
                </div>
                <Button
                  variant="outline"
                  disabled={open.isPending}
                  aria-label={`Open ${organisation.name}`}
                  onClick={() => open.mutate(organisation.id)}
                >
                  Open
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card>
        <h2 className="text-lg font-semibold">Create an organisation</h2>
        <p className="mt-1 text-sm opacity-75">You&apos;ll be its owner, and can invite others.</p>
        <form
          noValidate
          className="mt-5 flex flex-col gap-4"
          onSubmit={handleSubmit(async (values) => {
            clearFormError();
            try {
              await createOrganisation(values);
              changeSession("/dashboard");
            } catch (error) {
              handleApiError(error);
            }
          })}
        >
          {formError && <Alert variant="error">{formError.message}</Alert>}
          <OrganisationFields register={register} errors={errors} currentTimezone={browserZone} />
          <div>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Creating…" : "Create organisation"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
