"use client";

import { Suspense } from "react";

import { EditFuel } from "@/features/costs/cost-forms";
import { RequireOrganisation } from "@/features/organisation/require-organisation";

export default function Page() {
  return (
    <RequireOrganisation permission="costs.submit">
      {(membership) => (
        <Suspense>
          <EditFuel membership={membership} />
        </Suspense>
      )}
    </RequireOrganisation>
  );
}
