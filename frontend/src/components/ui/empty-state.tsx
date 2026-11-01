import type { LucideIcon } from "lucide-react";

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-box border border-dashed border-base-300 px-6 py-12 text-center">
      <Icon aria-hidden className="size-8 opacity-50" />
      <h2 className="mt-4 text-lg font-semibold">{title}</h2>
      <p className="mt-1 max-w-sm text-sm opacity-75">{children}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
