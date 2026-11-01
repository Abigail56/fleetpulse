"use client";

import { Suspense } from "react";

import { AlertList } from "@/features/alerts/alert-list";
import { RequireOrganisation } from "@/features/organisation/require-organisation";

export default function AlertsPage() {
  return (
    <RequireOrganisation permission="alerts.view">
      {(membership) => (
        <Suspense>
          <AlertList membership={membership} />
        </Suspense>
      )}
    </RequireOrganisation>
  );
}
