"use client";

import { RequireOrganisation } from "@/features/organisation/require-organisation";
import { DevicesCard } from "@/features/tracking/devices-card";
import { IntegrationsCard } from "@/features/tracking/integrations-card";

export default function TrackingPage() {
  return (
    <RequireOrganisation permission="vehicles.view">
      {({ permissions }) => (
        <div className="flex max-w-3xl flex-col gap-6">
          <h1 className="text-3xl font-bold tracking-tight">Tracking</h1>
          {permissions.includes("organisation.manage") && <IntegrationsCard />}
          <DevicesCard canManage={permissions.includes("vehicles.manage")} />
        </div>
      )}
    </RequireOrganisation>
  );
}
