"use client";

import { Suspense } from "react";

import { NewDefect } from "@/features/compliance/inspection-pages";
import { RequireOrganisation } from "@/features/organisation/require-organisation";

export default function Page() {
  return (
    <RequireOrganisation permission="inspections.submit">
      {() => (
        <Suspense>
          <NewDefect />
        </Suspense>
      )}
    </RequireOrganisation>
  );
}
