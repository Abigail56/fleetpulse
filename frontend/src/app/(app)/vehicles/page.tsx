"use client";

import { Suspense } from "react";

import { RequireOrganisation } from "@/features/organisation/require-organisation";
import { VehicleList } from "@/features/vehicles/vehicle-list";

export default function VehiclesPage() {
  return (
    <RequireOrganisation permission="vehicles.view">
      {(membership) => (
        <Suspense fallback={<div className="skeleton h-40 w-full" />}>
          <VehicleList membership={membership} />
        </Suspense>
      )}
    </RequireOrganisation>
  );
}
