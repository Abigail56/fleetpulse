"use client";

import { GeofenceForm } from "@/features/geofences/geofence-form";
import { RequireOrganisation } from "@/features/organisation/require-organisation";

export default function NewGeofencePage() {
  return (
    <RequireOrganisation permission="geofences.manage">
      {() => (
        <div className="flex max-w-4xl flex-col gap-6">
          <h1 className="text-3xl font-bold tracking-tight">New geofence</h1>
          <GeofenceForm />
        </div>
      )}
    </RequireOrganisation>
  );
}
