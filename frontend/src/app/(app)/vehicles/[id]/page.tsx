"use client";

import { Suspense } from "react";

import { RequireOrganisation } from "@/features/organisation/require-organisation";
import { VehicleDetail } from "@/features/vehicles/vehicle-detail";

export default function VehiclePage() {
  return (
    <RequireOrganisation permission="vehicles.view">
      {(membership) => (
        <Suspense fallback={<div className="skeleton h-40 w-full" />}>
          <VehicleDetail membership={membership} />
        </Suspense>
      )}
    </RequireOrganisation>
  );
}
