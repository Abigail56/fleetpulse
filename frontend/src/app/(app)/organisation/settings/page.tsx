"use client";

import { RequireOrganisation } from "@/features/organisation/require-organisation";
import { OrganisationSettings } from "@/features/organisation/settings";

export default function SettingsPage() {
  return (
    <RequireOrganisation permission="organisation.view">
      {(membership) => <OrganisationSettings membership={membership} />}
    </RequireOrganisation>
  );
}
