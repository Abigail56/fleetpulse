"use client";

import { Suspense } from "react";

import { NewFuel } from "@/features/costs/cost-forms";
import { RequireOrganisation } from "@/features/organisation/require-organisation";

export default function Page() {
  return (
    <RequireOrganisation permission="costs.submit">
      {(membership) => (
        <Suspense>
          <NewFuel membership={membership} />
        </Suspense>
      )}
    </RequireOrganisation>
  );
}
