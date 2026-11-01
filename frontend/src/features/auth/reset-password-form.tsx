"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Alert } from "@/components/ui/alert";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { clearAuthState } from "@/lib/api/client";

import { resetPassword } from "./api";
import { type ResetValues, resetSchema } from "./schemas";
import { useApiFormError } from "./use-api-form-error";
import { useOneTimeToken } from "./use-one-time-token";

export function ResetPasswordForm() {
  const token = useOneTimeToken();
  const queryClient = useQueryClient();
  const [done, setDone] = useState(false);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ResetValues>({
    resolver: zodResolver(resetSchema),
    defaultValues: { new_password: "", confirm_password: "" },
  });
  const { formError, clearFormError, handleApiError } = useApiFormError(setError, {
    weak_password: "new_password",
  });

  if (!token) {
    return (
      <Alert variant="error">
        This link is incomplete.{" "}
        <Link href="/forgot-password" className="link">
          Request a new reset link
        </Link>
        .
      </Alert>
    );
  }

  if (done) {
    return (
      <div className="flex flex-col gap-4">
        <Alert variant="success">
          Your password has been reset, and you&apos;ve been signed out everywhere.
        </Alert>
        <ButtonLink href="/login">Continue to sign in</ButtonLink>
      </div>
    );
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={handleSubmit(async ({ new_password }) => {
        clearFormError();
        try {
          await resetPassword({ token, new_password });
          clearAuthState();
          queryClient.clear();
          setDone(true);
        } catch (error) {
          handleApiError(error);
        }
      })}
    >
      {formError && (
        <Alert variant="error">
          <p>{formError.message}</p>
          {formError.code === "invalid_token" && (
            <Link href="/forgot-password" className="link mt-1 inline-block">
              Request a new reset link
            </Link>
          )}
        </Alert>
      )}
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
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Resetting…" : "Reset password"}
      </Button>
    </form>
  );
}
