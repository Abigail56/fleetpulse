"use client";

import { DashboardView } from "@/features/dashboard/dashboard-view";
import { RequireOrganisation } from "@/features/organisation/require-organisation";

export default function DashboardPage() {
  return (
    <RequireOrganisation>
      {({ organisation, permissions }) => (
        <DashboardView
          organisationName={organisation.name}
          canAddVehicles={permissions.includes("vehicles.manage")}
          canViewAlerts={permissions.includes("alerts.view")}
        />
      )}
    </RequireOrganisation>
  );
}
