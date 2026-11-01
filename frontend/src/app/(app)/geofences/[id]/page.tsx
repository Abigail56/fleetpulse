"use client";

import { Suspense } from "react";

import { GeofenceDetail } from "@/features/geofences/geofence-detail";
import { RequireOrganisation } from "@/features/organisation/require-organisation";

export default function GeofencePage() {
  return (
    <RequireOrganisation permission="geofences.view">
      {(membership) => (
        <Suspense>
          <GeofenceDetail membership={membership} />
        </Suspense>
      )}
    </RequireOrganisation>
  );
}
