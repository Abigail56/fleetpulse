"use client";

import { Suspense } from "react";

import { EditRule } from "@/features/automation/rule-form";
import { RequireOrganisation } from "@/features/organisation/require-organisation";

export default function EditRulePage() {
  return (
    <RequireOrganisation permission="automation.manage">
      {() => (
        <Suspense>
          <EditRule />
        </Suspense>
      )}
    </RequireOrganisation>
  );
}
