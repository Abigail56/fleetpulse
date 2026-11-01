"use client";

import { Suspense } from "react";

import { EditGeofence } from "@/features/geofences/geofence-detail";
import { RequireOrganisation } from "@/features/organisation/require-organisation";

export default function EditGeofencePage() {
  return (
    <RequireOrganisation permission="geofences.manage">
      {() => (
        <Suspense>
          <EditGeofence />
        </Suspense>
      )}
    </RequireOrganisation>
  );
}
