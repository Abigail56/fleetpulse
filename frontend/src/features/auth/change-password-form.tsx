"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";

import { changePassword, SESSIONS_KEY } from "./api";
import { type ChangePasswordValues, changePasswordSchema } from "./schemas";
import { useApiFormError } from "./use-api-form-error";

const EMPTY = { current_password: "", new_password: "", confirm_password: "" };

export function ChangePasswordForm() {
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: EMPTY,
  });
  const { formError, clearFormError, handleApiError } = useApiFormError(setError, {
    incorrect_password: "current_password",
    weak_password: "new_password",
  });

  return (
    <Card>
      <h2 className="text-lg font-semibold">Change password</h2>
      <p className="mt-1 text-sm opacity-75">Your other devices will be signed out.</p>
      <form
        noValidate
        className="mt-5 flex max-w-md flex-col gap-4"
        onSubmit={handleSubmit(async ({ current_password, new_password }) => {
          clearFormError();
          try {
            await changePassword({ current_password, new_password });
            reset(EMPTY);
            toast.success("Your password has been changed.");
            void queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });
          } catch (error) {
            handleApiError(error);
          }
        })}
      >
        {formError && <Alert variant="error">{formError.message}</Alert>}
        <Field
          id="current_password"
          label="Current password"
          required
          error={errors.current_password?.message}
        >
          {(describedBy) => (
            <PasswordInput
              id="current_password"
              autoComplete="current-password"
              aria-invalid={errors.current_password ? true : undefined}
              aria-describedby={describedBy}
              {...register("current_password")}
            />
          )}
        </Field>
        <Field
          id="new_password"
          label="New password"
          required
          hint="At least 12 characters."
          error={errors.new_password?.message}
        >
          {(describedBy) => (
            <PasswordInput
              id="new_password"
              autoComplete="new-password"
              aria-invalid={errors.new_password ? true : undefined}
              aria-describedby={describedBy}
              {...register("new_password")}
            />
          )}
        </Field>
        <Field
          id="confirm_password"
          label="Confirm new password"
          required
          error={errors.confirm_password?.message}
        >
          {(describedBy) => (
            <PasswordInput
              id="confirm_password"
              autoComplete="new-password"
              aria-invalid={errors.confirm_password ? true : undefined}
              aria-describedby={describedBy}
              {...register("confirm_password")}
            />
          )}
        </Field>
        <div>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Changing…" : "Change password"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
