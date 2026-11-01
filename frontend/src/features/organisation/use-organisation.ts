"use client";

import { useQuery } from "@tanstack/react-query";

import { ApiError } from "@/lib/api/client";

import { fetchCurrent, KEYS } from "./api";

/** Resolves to null when no organisation is chosen, which is a normal state for new users. */
export function useCurrentOrganisation() {
  return useQuery({
    queryKey: KEYS.current,
    queryFn: async () => {
      try {
        return await fetchCurrent();
      } catch (error) {
        if (error instanceof ApiError && error.code === "no_active_organisation") return null;
        throw error;
      }
    },
  });
}
