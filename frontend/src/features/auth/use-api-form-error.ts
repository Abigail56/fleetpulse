"use client";

import { useState } from "react";
import type { FieldValues, Path, UseFormSetError } from "react-hook-form";

import { ApiError } from "@/lib/api/client";

const FALLBACK = "Something went wrong. Please try again.";

/** Puts API errors on the matching field where possible, and otherwise at the top of the form. */
export function useApiFormError<T extends FieldValues>(
  setError: UseFormSetError<T>,
  fieldForCode: Record<string, Path<T>> = {},
) {
  const [formError, setFormError] = useState<ApiError | { code: string; message: string } | null>(
    null,
  );

  function handle(error: unknown) {
    if (!(error instanceof ApiError)) {
      console.error("unexpected_form_error:", error);
      setFormError({ code: "unexpected_error", message: FALLBACK });
      return;
    }
    const field = fieldForCode[error.code];
    if (field) {
      setError(field, { message: error.message });
      return;
    }
    if (error.code === "validation_error" && error.fields.length > 0) {
      for (const item of error.fields) {
        const name = item.field.replace(/^body\./, "") as Path<T>;
        setError(name, { message: item.message });
      }
      return;
    }
    setFormError(error);
  }

  return { formError, clearFormError: () => setFormError(null), handleApiError: handle };
}
