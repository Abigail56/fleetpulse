"use client";

import { Suspense } from "react";

import { EditTemplate } from "@/features/compliance/compliance-forms";
import { RequireOrganisation } from "@/features/organisation/require-organisation";

export default function Page() {
  return (
    <RequireOrganisation permission="compliance.manage">
      {() => (
        <Suspense>
          <EditTemplate />
        </Suspense>
      )}
    </RequireOrganisation>
  );
}
