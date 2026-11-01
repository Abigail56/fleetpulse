"use client";

import { GeofenceList } from "@/features/geofences/geofence-list";
import { RequireOrganisation } from "@/features/organisation/require-organisation";

export default function GeofencesPage() {
  return (
    <RequireOrganisation permission="geofences.view">
      {(membership) => <GeofenceList membership={membership} />}
    </RequireOrganisation>
  );
}
