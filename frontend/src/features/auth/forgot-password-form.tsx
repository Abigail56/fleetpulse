"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";

import { forgotPassword } from "./api";
import { type EmailValues, emailSchema } from "./schemas";
import { useApiFormError } from "./use-api-form-error";

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<EmailValues>({
    resolver: zodResolver(emailSchema),
    defaultValues: { email: "" },
  });
  const { formError, clearFormError, handleApiError } = useApiFormError(setError);

  if (sent) {
    return (
      <Alert variant="success">
        If an account uses that address, a reset link is on its way. It expires in 30 minutes.
      </Alert>
    );
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={handleSubmit(async ({ email }) => {
        clearFormError();
        try {
          await forgotPassword(email);
          setSent(true);
        } catch (error) {
          handleApiError(error);
        }
      })}
    >
      {formError && <Alert variant="error">{formError.message}</Alert>}
      <Field id="email" label="Email" required error={errors.email?.message}>
        {(describedBy) => (
          <TextInput
            id="email"
            type="email"
            autoComplete="username"
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={describedBy}
            {...register("email")}
          />
        )}
      </Field>
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Sending…" : "Send reset link"}
      </Button>
      <Link href="/login" className="link text-sm">
        Back to sign in
      </Link>
    </form>
  );
}
