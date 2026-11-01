"use client";

import { Suspense } from "react";

import { ScheduleDetail } from "@/features/maintenance/schedule-pages";
import { RequireOrganisation } from "@/features/organisation/require-organisation";

export default function Page() {
  return (
    <RequireOrganisation permission="maintenance.view">
      {(membership) => (
        <Suspense>
          <ScheduleDetail membership={membership} />
        </Suspense>
      )}
    </RequireOrganisation>
  );
}
