"use client";

import { Suspense } from "react";

import { InspectionDetail } from "@/features/compliance/inspection-pages";
import { RequireOrganisation } from "@/features/organisation/require-organisation";

export default function Page() {
  return (
    <RequireOrganisation permission="inspections.submit">
      {(membership) => (
        <Suspense>
          <InspectionDetail membership={membership} />
        </Suspense>
      )}
    </RequireOrganisation>
  );
}
