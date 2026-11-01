"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";

import { registerAccount } from "./api";
import { GoogleButton } from "./google-button";
import { type RegisterValues, registerSchema } from "./schemas";
import { useApiFormError } from "./use-api-form-error";

export function RegisterForm() {
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { full_name: "", email: "", password: "" },
  });
  const { formError, clearFormError, handleApiError } = useApiFormError(setError, {
    weak_password: "password",
  });

  if (submittedEmail) {
    return (
      <Alert variant="success">
        <p className="font-semibold">Check your email</p>
        <p className="mt-1">
          We&apos;ve sent next steps to {submittedEmail}. Open the link and enter the password you
          just chose. If nothing arrives, check your spam folder.
        </p>
      </Alert>
    );
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={handleSubmit(async (values) => {
        clearFormError();
        try {
          await registerAccount(values);
          setSubmittedEmail(values.email);
        } catch (error) {
          handleApiError(error);
        }
      })}
    >
      <GoogleButton label="Sign up with Google" />
      {formError && <Alert variant="error">{formError.message}</Alert>}
      <Field id="full_name" label="Your name" required error={errors.full_name?.message}>
        {(describedBy) => (
          <TextInput
            id="full_name"
            autoComplete="name"
            aria-invalid={errors.full_name ? true : undefined}
            aria-describedby={describedBy}
            {...register("full_name")}
          />
        )}
      </Field>
      <Field id="email" label="Work email" required error={errors.email?.message}>
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
      <Field
        id="password"
        label="Password"
        required
        hint="At least 12 characters. A short phrase works well."
        error={errors.password?.message}
      >
        {(describedBy) => (
          <PasswordInput
            id="password"
            autoComplete="new-password"
            aria-invalid={errors.password ? true : undefined}
            aria-describedby={describedBy}
            {...register("password")}
          />
        )}
      </Field>
      <p className="text-xs opacity-75">
        By creating an account, you agree to our{" "}
        <Link href="/terms" className="link">
          Terms and Conditions
        </Link>{" "}
        and{" "}
        <Link href="/privacy" className="link">
          Privacy Policy
        </Link>
        .
      </p>
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Creating your account…" : "Create account"}
      </Button>
      <p className="text-sm">
        Already have an account?{" "}
        <Link href="/login" className="link">
          Sign in
        </Link>
      </p>
    </form>
  );
}
