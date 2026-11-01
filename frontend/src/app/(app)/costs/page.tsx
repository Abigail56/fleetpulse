"use client";

import { Suspense } from "react";

import { CostsOverview } from "@/features/costs/costs-overview";
import { RequireOrganisation } from "@/features/organisation/require-organisation";

export default function Page() {
  return (
    <RequireOrganisation permission="costs.submit">
      {(membership) => (
        <Suspense>
          <CostsOverview membership={membership} />
        </Suspense>
      )}
    </RequireOrganisation>
  );
}
