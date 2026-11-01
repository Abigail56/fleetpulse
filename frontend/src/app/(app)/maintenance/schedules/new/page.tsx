"use client";

import { Suspense } from "react";

import { NewSchedule } from "@/features/maintenance/schedule-pages";
import { RequireOrganisation } from "@/features/organisation/require-organisation";

export default function Page() {
  return (
    <RequireOrganisation permission="maintenance.manage">
      {(membership) => (
        <Suspense>
          <NewSchedule membership={membership} />
        </Suspense>
      )}
    </RequireOrganisation>
  );
}
