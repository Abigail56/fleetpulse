"use client";

import { AutomationOverview } from "@/features/automation/automation-overview";
import { RequireOrganisation } from "@/features/organisation/require-organisation";

export default function AutomationPage() {
  return (
    <RequireOrganisation permission="automation.manage">
      {() => <AutomationOverview />}
    </RequireOrganisation>
  );
}
