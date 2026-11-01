"use client";

import { Suspense } from "react";

import { ComplianceOverview } from "@/features/compliance/compliance-overview";
import { RequireOrganisation } from "@/features/organisation/require-organisation";

export default function Page() {
  return (
    <RequireOrganisation>
      {(membership) => (
        <Suspense>
          <ComplianceOverview membership={membership} />
        </Suspense>
      )}
    </RequireOrganisation>
  );
}
