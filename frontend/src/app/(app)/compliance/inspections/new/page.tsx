"use client";

import { Suspense } from "react";

import { NewInspection } from "@/features/compliance/inspection-pages";
import { RequireOrganisation } from "@/features/organisation/require-organisation";

export default function Page() {
  return (
    <RequireOrganisation permission="inspections.submit">
      {(membership) => (
        <Suspense>
          <NewInspection membership={membership} />
        </Suspense>
      )}
    </RequireOrganisation>
  );
}
