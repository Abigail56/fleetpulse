"use client";

import { Suspense } from "react";

import { NewDocument } from "@/features/compliance/compliance-forms";
import { RequireOrganisation } from "@/features/organisation/require-organisation";

export default function Page() {
  return (
    <RequireOrganisation permission="compliance.manage">
      {() => (
        <Suspense>
          <NewDocument />
        </Suspense>
      )}
    </RequireOrganisation>
  );
}
