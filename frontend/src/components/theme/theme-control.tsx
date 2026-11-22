"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

import { cn } from "@/lib/cn";

const OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

const subscribe = () => () => {};

export function ThemeControl({
  className,
  showLabels = false,
}: {
  className?: string;
  showLabels?: boolean;
}) {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);

  return (
    <div
      role="group"
      aria-label="Appearance"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-field border border-base-300 bg-base-200/70 p-1",
        className,
      )}
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const selected = mounted && theme === value;
        return (
          <button
            key={value}
            type="button"
            aria-label={`${label} theme`}
            aria-pressed={selected}
            title={`${label} theme`}
            onClick={() => setTheme(value)}
            className={cn(
              "inline-flex min-h-11 min-w-11 cursor-pointer touch-manipulation items-center justify-center gap-2 rounded-[3px] px-2 text-xs font-medium text-base-content/70 transition-colors duration-200 hover:bg-base-300 hover:text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary motion-reduce:transition-none",
              selected && "bg-base-100 text-primary shadow-sm",
              showLabels && "justify-start px-2.5",
            )}
          >
            <Icon
              aria-hidden
              className={cn(
                "size-4 shrink-0 transition-transform duration-200 motion-reduce:transition-none",
                selected && "scale-110",
              )}
            />
            {showLabels && <span>{label}</span>}
          </button>
        );
      })}
    </div>
  );
}
