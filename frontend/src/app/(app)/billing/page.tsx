"use client";

import { Suspense } from "react";

import { Billing } from "@/features/billing/billing";
import { RequireOrganisation } from "@/features/organisation/require-organisation";

export default function BillingPage() {
  return (
    <RequireOrganisation permission="billing.manage">
      {() => (
        <Suspense>
          <Billing />
        </Suspense>
      )}
    </RequireOrganisation>
  );
}
