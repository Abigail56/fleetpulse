"use client";

import { Eye, EyeOff } from "lucide-react";
import { type InputHTMLAttributes, type Ref, useState } from "react";

import { TextInput } from "@/components/ui/field";

export function PasswordInput({
  ref,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  ref?: Ref<HTMLInputElement>;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <TextInput ref={ref} type={visible ? "text" : "password"} className="pr-11" {...props} />
      <button
        type="button"
        aria-label="Show password"
        aria-pressed={visible}
        onClick={() => setVisible((value) => !value)}
        className="btn btn-ghost btn-square btn-sm absolute top-1/2 right-1 z-10 -translate-y-1/2"
      >
        {visible ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
      </button>
    </div>
  );
}
