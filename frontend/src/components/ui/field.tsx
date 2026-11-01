import type { ReactElement, Ref } from "react";
import type {
  InputHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

import { cn } from "@/lib/cn";

type FieldProps = {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: (describedBy: string | undefined) => ReactElement;
};

/** Connects the label, hint and error to the control for screen readers. */
export function Field({
  id,
  label,
  error,
  hint,
  required,
  children,
}: FieldProps) {
  const descriptions = [hint && `${id}-hint`, error && `${id}-error`].filter(
    Boolean,
  );
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {!required && <span className="font-normal opacity-65"> (optional)</span>}
      </label>
      {children(descriptions.join(" ") || undefined)}
      {hint && (
        <p id={`${id}-hint`} className="text-xs opacity-70">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-sm text-error">
          {error}
        </p>
      )}
    </div>
  );
}

export function TextInput({
  className,
  ref,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return (
    <input
      ref={ref}
      className={cn(
        "input w-full aria-invalid:input-error",
        className,
      )}
      {...props}
    />
  );
}

export function TextArea({
  className,
  ref,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  ref?: Ref<HTMLTextAreaElement>;
}) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "textarea w-full aria-invalid:textarea-error",
        className,
      )}
      {...props}
    />
  );
}

export function SelectInput({
  className,
  ref,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  ref?: Ref<HTMLSelectElement>;
}) {
  return (
    <select ref={ref} className={cn("select w-full", className)} {...props} />
  );
}
