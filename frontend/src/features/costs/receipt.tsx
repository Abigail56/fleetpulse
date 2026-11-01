"use client";

import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";

import { fetchFileLink, type StoredFile, uploadReceipt } from "./api";

const MAX_BYTES = 10 * 1024 * 1024;

/** The link is requested when clicked, because links expire within minutes. */
export function ReceiptLink({ file }: { file: StoredFile }) {
  const open = useMutation({
    mutationFn: () => fetchFileLink(file.id),
    onSuccess: ({ url }) => {
      window.location.assign(url);
    },
    onError: (error) => toast.error(error.message),
  });
  return (
    <button
      type="button"
      className="link text-left"
      disabled={open.isPending}
      onClick={() => open.mutate()}
    >
      Download {file.filename}
    </button>
  );
}

export function ReceiptField({
  value,
  onChange,
  label = "Receipt",
  upload: send = uploadReceipt,
}: {
  value: StoredFile | null;
  onChange: (file: StoredFile | null) => void;
  label?: string;
  upload?: (file: File) => Promise<StoredFile>;
}) {
  const [error, setError] = useState<string | undefined>();
  const upload = useMutation({
    mutationFn: send,
    onSuccess: (file) => {
      setError(undefined);
      onChange(file);
    },
    onError: (failure) => setError(failure.message),
  });
  return (
    <Field id="receipt" label={label} hint="A PDF, JPEG, PNG or WebP, up to 10 MB." error={error}>
      {(describedBy) =>
        value ? (
          <p className="flex flex-wrap items-center gap-3 text-sm">
            {value.filename}
            <Button variant="ghost" onClick={() => onChange(null)}>
              Remove
            </Button>
          </p>
        ) : (
          <input
            id="receipt"
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            className="file-input w-full"
            disabled={upload.isPending}
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              if (file.size > MAX_BYTES) setError("Files can be up to 10 MB.");
              else upload.mutate(file);
            }}
          />
        )
      }
    </Field>
  );
}
