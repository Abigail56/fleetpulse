"use client";

import { Suspense } from "react";

import { RequireOrganisation } from "@/features/organisation/require-organisation";
import { Reports } from "@/features/reports/reports";

export default function ReportsPage() {
  return (
    <RequireOrganisation permission="reports.view">
      {(membership) => (
        <Suspense>
          <Reports unit={membership.organisation.distance_unit} />
        </Suspense>
      )}
    </RequireOrganisation>
  );
}
