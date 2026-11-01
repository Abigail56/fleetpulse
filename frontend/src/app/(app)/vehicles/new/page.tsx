"use client";

import { RequireOrganisation } from "@/features/organisation/require-organisation";
import { VehicleForm } from "@/features/vehicles/vehicle-form";

export default function NewVehiclePage() {
  return (
    <RequireOrganisation permission="vehicles.manage">
      {(membership) => (
        <div className="flex max-w-3xl flex-col gap-6">
          <h1 className="text-3xl font-bold tracking-tight">Add a vehicle</h1>
          <VehicleForm unit={membership.organisation.distance_unit} />
        </div>
      )}
    </RequireOrganisation>
  );
}
