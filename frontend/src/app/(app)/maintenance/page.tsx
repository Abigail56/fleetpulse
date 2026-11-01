"use client";

import { Suspense } from "react";

import { MaintenanceOverview } from "@/features/maintenance/maintenance-overview";
import { RequireOrganisation } from "@/features/organisation/require-organisation";

export default function Page() {
  return (
    <RequireOrganisation permission="maintenance.view">
      {(membership) => (
        <Suspense>
          <MaintenanceOverview membership={membership} />
        </Suspense>
      )}
    </RequireOrganisation>
  );
}
