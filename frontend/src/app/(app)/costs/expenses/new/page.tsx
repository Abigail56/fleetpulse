"use client";

import { Suspense } from "react";

import { NewExpense } from "@/features/costs/cost-forms";
import { RequireOrganisation } from "@/features/organisation/require-organisation";

export default function Page() {
  return (
    <RequireOrganisation permission="costs.submit">
      {() => (
        <Suspense>
          <NewExpense />
        </Suspense>
      )}
    </RequireOrganisation>
  );
}
