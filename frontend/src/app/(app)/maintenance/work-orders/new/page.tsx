"use client";

import { Suspense } from "react";

import { NewWorkOrder } from "@/features/maintenance/work-order-pages";
import { RequireOrganisation } from "@/features/organisation/require-organisation";

export default function Page() {
  return (
    <RequireOrganisation permission="maintenance.manage">
      {() => (
        <Suspense>
          <NewWorkOrder />
        </Suspense>
      )}
    </RequireOrganisation>
  );
}
