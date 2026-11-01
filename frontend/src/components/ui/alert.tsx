import { CircleAlert, CircleCheck, Info } from "lucide-react";

import { cn } from "@/lib/cn";

const VARIANTS = {
  info: { style: "border-info text-base-content", Icon: Info },
  success: { style: "border-success text-base-content", Icon: CircleCheck },
  error: { style: "border-error text-base-content", Icon: CircleAlert },
};

export function Alert({
  variant,
  children,
  className,
}: {
  variant: keyof typeof VARIANTS;
  children: React.ReactNode;
  className?: string;
}) {
  const { style, Icon } = VARIANTS[variant];
  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-3 rounded-box border-l-4 bg-base-200 p-4 text-sm",
        style,
        className,
      )}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div>{children}</div>
    </div>
  );
}
