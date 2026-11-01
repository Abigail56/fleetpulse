"use client";

import { Suspense } from "react";

import { WorkOrderDetail } from "@/features/maintenance/work-order-pages";
import { RequireOrganisation } from "@/features/organisation/require-organisation";

export default function Page() {
  return (
    <RequireOrganisation permission="maintenance.view">
      {(membership) => (
        <Suspense>
          <WorkOrderDetail membership={membership} />
        </Suspense>
      )}
    </RequireOrganisation>
  );
}
