import type { HTMLAttributes } from "react";

import { cn } from "@/lib/cn";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-box border border-base-300 bg-base-100 p-6",
        className,
      )}
      {...props}
    />
  );
}
