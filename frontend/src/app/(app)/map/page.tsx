"use client";

import { Suspense } from "react";

import { LiveMap } from "@/features/live-map/live-map";
import { RequireOrganisation } from "@/features/organisation/require-organisation";

export default function MapPage() {
  return (
    <RequireOrganisation permission="vehicles.view">
      {({ permissions }) => (
        <Suspense>
          <LiveMap
            canManage={permissions.includes("vehicles.manage")}
            canViewDrivers={permissions.includes("drivers.view")}
            canViewGeofences={permissions.includes("geofences.view")}
          />
        </Suspense>
      )}
    </RequireOrganisation>
  );
}
