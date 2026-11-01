"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, SelectInput, TextInput } from "@/components/ui/field";
import { useApiFormError } from "@/features/auth/use-api-form-error";

import {
  createInvitation,
  type CurrentMembership,
  fetchInvitations,
  type Invitation,
  KEYS,
  revokeInvitation,
} from "./api";
import { grantableRoles, ROLE_LABELS } from "./roles";
import { type InvitationValues, invitationSchema } from "./schemas";

export function Invitations({ membership }: { membership: CurrentMembership }) {
  const queryClient = useQueryClient();
  const invitations = useQuery({ queryKey: KEYS.invitations, queryFn: fetchInvitations });
  const [toRevoke, setToRevoke] = useState<Invitation | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<InvitationValues>({
    resolver: zodResolver(invitationSchema),
    defaultValues: { email: "", role: "read_only" },
  });
  const { formError, clearFormError, handleApiError } = useApiFormError(setError, {
    already_member: "email",
  });
  const revoke = useMutation({
    mutationFn: revokeInvitation,
    onSuccess: () => {
      setToRevoke(null);
      toast.success("Invitation cancelled.");
      return queryClient.invalidateQueries({ queryKey: KEYS.invitations });
    },
    onError: (error) => {
      setToRevoke(null);
      toast.error(error.message);
    },
  });

  return (
    <div>
      <form
        noValidate
        className="grid items-start gap-4 sm:grid-cols-[2fr_1fr_auto]"
        onSubmit={handleSubmit(async (values) => {
          clearFormError();
          try {
            await createInvitation(values);
            reset();
            toast.success(`Invitation sent to ${values.email}.`);
            await queryClient.invalidateQueries({ queryKey: KEYS.invitations });
          } catch (error) {
            handleApiError(error);
          }
        })}
      >
        {formError && (
          <div className="sm:col-span-3">
            <Alert variant="error">{formError.message}</Alert>
          </div>
        )}
        <Field id="invite_email" label="Email" required error={errors.email?.message}>
          {(describedBy) => (
            <TextInput
              id="invite_email"
              type="email"
              autoComplete="off"
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={describedBy}
              {...register("email")}
            />
          )}
        </Field>
        <Field id="invite_role" label="Role" required>
          {() => (
            <SelectInput id="invite_role" {...register("role")}>
              {grantableRoles(membership.role).map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </SelectInput>
          )}
        </Field>
        <Button type="submit" className="sm:mt-6.5" disabled={isSubmitting}>
          {isSubmitting ? "Sending…" : "Send invitation"}
        </Button>
      </form>

      <h3 className="mt-6 text-sm font-semibold">Pending invitations</h3>
      {invitations.isPending && <div className="skeleton mt-2 h-12 w-full" />}
      {invitations.isError && (
        <Alert variant="error" className="mt-2">
          {invitations.error.message}
        </Alert>
      )}
      {invitations.data?.length === 0 && (
        <p className="mt-1 text-sm opacity-70">No invitations are waiting to be accepted.</p>
      )}
      {invitations.data && invitations.data.length > 0 && (
        <ul className="mt-2 divide-y divide-base-300 border-y border-base-300">
          {invitations.data.map((invitation) => (
            <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{invitation.email}</p>
                <p className="text-sm opacity-70">
                  {ROLE_LABELS[invitation.role]}, expires{" "}
                  {format(new Date(invitation.expires_at), "d MMM yyyy")}
                </p>
              </div>
              <Button
                variant="ghost"
                aria-label={`Cancel invitation to ${invitation.email}`}
                onClick={() => setToRevoke(invitation)}
              >
                Cancel
              </Button>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={toRevoke !== null}
        title="Cancel this invitation?"
        confirmLabel="Cancel invitation"
        busy={revoke.isPending}
        onConfirm={() => toRevoke && revoke.mutate(toRevoke.id)}
        onCancel={() => setToRevoke(null)}
      >
        The link sent to {toRevoke?.email} will stop working.
      </ConfirmDialog>
    </div>
  );
}
