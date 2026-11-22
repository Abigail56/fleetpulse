"use client";

import { useQuery } from "@tanstack/react-query";

import { CURRENT_USER_KEY, fetchCurrentUser } from "./api";

export function useCurrentUser(enabled = true) {
  return useQuery({ queryKey: CURRENT_USER_KEY, queryFn: fetchCurrentUser, enabled });
}
