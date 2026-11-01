"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { safeRedirectPath } from "@/lib/safe-redirect";

import { CURRENT_USER_KEY, login, resendVerification } from "./api";
import { GoogleButton } from "./google-button";
import { type LoginValues, loginSchema } from "./schemas";
import { useApiFormError } from "./use-api-form-error";

const GOOGLE_ERRORS: Record<string, string> = {
  google_cancelled: "Google sign-in was cancelled. You can try again or use your password.",
  google_failed: "We couldn't sign you in with Google. Please try again or use your password.",
  google_unavailable: "Google sign-in isn't available right now. Please use your password.",
};

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [resent, setResent] = useState(false);
  const {
    register,
    handleSubmit,
    getValues,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });
  const { formError, clearFormError, handleApiError } = useApiFormError(setError);
  const googleError = GOOGLE_ERRORS[searchParams.get("error") ?? ""];

  async function onSubmit(values: LoginValues) {
    clearFormError();
    setResent(false);
    try {
      const { user } = await login(values);
      queryClient.setQueryData(CURRENT_USER_KEY, user);
      // Don't leave the password in the form while navigating away.
      reset();
      router.replace(safeRedirectPath(searchParams.get("next")));
    } catch (error) {
      handleApiError(error);
    }
  }

  async function onResend() {
    try {
      await resendVerification(getValues("email"));
      setResent(true);
    } catch (error) {
      handleApiError(error);
    }
  }

  return (
    <form noValidate className="flex flex-col gap-4" onSubmit={handleSubmit(onSubmit)}>
      <GoogleButton next={searchParams.get("next")} label="Continue with Google" />
      {googleError && !formError && <Alert variant="error">{googleError}</Alert>}
      {resent && (
        <Alert variant="success">
          If that account still needs verifying, a new email is on its way.
        </Alert>
      )}
      {formError && !resent && (
        <Alert variant="error">
          <p>{formError.message}</p>
          {formError.code === "email_not_verified" && (
            <button type="button" className="link mt-1 font-medium" onClick={onResend}>
              Send a new verification email
            </button>
          )}
        </Alert>
      )}
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
        {isSubmitting ? "Signing in…" : "Sign in"}
      </Button>
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        <Link href="/forgot-password" className="link">
          Forgot your password?
        </Link>
        <Link href="/register" className="link">
          Create an account
        </Link>
      </div>
    </form>
  );
}
