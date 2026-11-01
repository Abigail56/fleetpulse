"use client";

import { Suspense } from "react";

import { RequireOrganisation } from "@/features/organisation/require-organisation";
import { EditVehicle } from "@/features/vehicles/vehicle-detail";

export default function EditVehiclePage() {
  return (
    <RequireOrganisation permission="vehicles.manage">
      {(membership) => (
        <Suspense fallback={<div className="skeleton h-40 w-full" />}>
          <EditVehicle membership={membership} />
        </Suspense>
      )}
    </RequireOrganisation>
  );
}
