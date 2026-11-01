"use client";

import { Suspense } from "react";

import { EditSchedule } from "@/features/maintenance/schedule-pages";
import { RequireOrganisation } from "@/features/organisation/require-organisation";

export default function Page() {
  return (
    <RequireOrganisation permission="maintenance.manage">
      {(membership) => (
        <Suspense>
          <EditSchedule membership={membership} />
        </Suspense>
      )}
    </RequireOrganisation>
  );
}
