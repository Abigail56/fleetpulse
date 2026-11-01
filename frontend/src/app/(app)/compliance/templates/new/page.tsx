"use client";

import { Suspense } from "react";

import { NewTemplate } from "@/features/compliance/compliance-forms";
import { RequireOrganisation } from "@/features/organisation/require-organisation";

export default function Page() {
  return (
    <RequireOrganisation permission="compliance.manage">
      {() => (
        <Suspense>
          <NewTemplate />
        </Suspense>
      )}
    </RequireOrganisation>
  );
}
