import { cn } from "@/lib/cn";

export type Status = "neutral" | "success" | "warning" | "error" | "info";

const STYLES: Record<Status, string> = {
  neutral: "badge-ghost",
  success: "badge-success",
  warning: "badge-warning",
  error: "badge-error",
  info: "badge-info",
};

/** Always carries a text label: status is never conveyed by colour alone. */
export function StatusBadge({
  status,
  children,
  className,
}: {
  status: Status;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("badge badge-sm font-medium", STYLES[status], className)}>
      {children}
    </span>
  );
}
