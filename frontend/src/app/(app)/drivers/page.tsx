"use client";

import { Suspense } from "react";

import { DriverList } from "@/features/drivers/driver-list";
import { RequireOrganisation } from "@/features/organisation/require-organisation";

export default function DriversPage() {
  return (
    <RequireOrganisation permission="drivers.view">
      {(membership) => (
        <Suspense fallback={<div className="skeleton h-40 w-full" />}>
          <DriverList membership={membership} />
        </Suspense>
      )}
    </RequireOrganisation>
  );
}
