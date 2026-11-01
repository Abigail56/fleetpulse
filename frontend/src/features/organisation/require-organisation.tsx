"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

import type { CurrentMembership } from "./api";
import { useCurrentOrganisation } from "./use-organisation";

/** Sends people with no organisation to choose or create one. Display only; the API enforces. */
export function RequireOrganisation({
  permission,
  children,
}: {
  permission?: string;
  children: (membership: CurrentMembership) => React.ReactNode;
}) {
  const current = useCurrentOrganisation();
  const router = useRouter();
  const missing = current.isSuccess && current.data === null;

  useEffect(() => {
    if (missing) router.replace("/onboarding");
  }, [missing, router]);

  if (current.isError) {
    return (
      <div className="flex flex-col items-start gap-3">
        <Alert variant="error">{current.error.message}</Alert>
        <Button variant="outline" onClick={() => current.refetch()}>
          Try again
        </Button>
      </div>
    );
  }
  if (!current.data) {
    return (
      <div role="status" aria-label="Loading" className="flex flex-col gap-3">
        <div className="skeleton h-8 w-1/2" />
        <div className="skeleton h-40 w-full" />
      </div>
    );
  }
  if (permission && !current.data.permissions.includes(permission)) {
    return <Alert variant="info">Your role in this organisation doesn&apos;t include this page.</Alert>;
  }
  return children(current.data);
}
