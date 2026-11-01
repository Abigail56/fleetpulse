"use client";

import { Suspense } from "react";

import { DriverDetail } from "@/features/drivers/driver-detail";
import { RequireOrganisation } from "@/features/organisation/require-organisation";

export default function DriverPage() {
  return (
    <RequireOrganisation permission="drivers.view">
      {(membership) => (
        <Suspense fallback={<div className="skeleton h-40 w-full" />}>
          <DriverDetail membership={membership} />
        </Suspense>
      )}
    </RequireOrganisation>
  );
}
