"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";

/**
 * Keeps list filters in the URL, so they can be shared and survive a reload. Next.js applies URL
 * changes slightly later, so new values are held until it catches up, or a clicked checkbox would
 * briefly spring back.
 */
export function useUrlFilters<T>(read: (params: URLSearchParams) => T) {
  const pathname = usePathname();
  const current = useSearchParams().toString();
  const [pending, setPending] = useState<{ query: string; filters: T } | null>(null);

  if (pending && pending.query === current) setPending(null);
  const filters = pending ? pending.filters : read(new URLSearchParams(current));

  function commit(next: T, query: string) {
    setPending({ query, filters: next });
    window.history.replaceState(null, "", query ? `${pathname}?${query}` : pathname);
  }

  return [filters, commit] as const;
}
