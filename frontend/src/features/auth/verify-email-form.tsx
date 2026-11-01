"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Alert } from "@/components/ui/alert";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";

import { verifyEmail } from "./api";
import { type VerifyValues, verifySchema } from "./schemas";
import { useApiFormError } from "./use-api-form-error";
import { useOneTimeToken } from "./use-one-time-token";

export function VerifyEmailForm() {
  const token = useOneTimeToken();
  const [verified, setVerified] = useState(false);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<VerifyValues>({
    resolver: zodResolver(verifySchema),
    defaultValues: { password: "" },
  });
  const { formError, clearFormError, handleApiError } = useApiFormError(setError, {
    incorrect_password: "password",
  });

  if (!token) {
    return (
      <Alert variant="error">
        This link is incomplete. Please open the link from your email again, or{" "}
        <Link href="/login" className="link">
          sign in to request a new one
        </Link>
        .
      </Alert>
    );
  }

  if (verified) {
    return (
      <div className="flex flex-col gap-4">
        <Alert variant="success">Your email address is verified.</Alert>
        <ButtonLink href="/login">Continue to sign in</ButtonLink>
      </div>
    );
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={handleSubmit(async ({ password }) => {
        clearFormError();
        try {
          await verifyEmail({ token, password });
          setVerified(true);
        } catch (error) {
          handleApiError(error);
        }
      })}
    >
      <p className="text-sm opacity-85">
        Enter the password you chose when you registered. If you didn&apos;t register, close this
        page; nothing will happen.
      </p>
      {formError && <Alert variant="error">{formError.message}</Alert>}
      <Field id="password" label="Password" required error={errors.password?.message}>
        {(describedBy) => (
          <PasswordInput
            id="password"
            autoComplete="current-password"
            aria-invalid={errors.password ? true : undefined}
            aria-describedby={describedBy}
            {...register("password")}
          />
        )}
      </Field>
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Verifying…" : "Verify email"}
      </Button>
    </form>
  );
}
