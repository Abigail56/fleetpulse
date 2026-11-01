"use client";

import { Suspense } from "react";

import { EditDriver } from "@/features/drivers/driver-detail";
import { RequireOrganisation } from "@/features/organisation/require-organisation";

export default function EditDriverPage() {
  return (
    <RequireOrganisation permission="drivers.manage">
      {() => (
        <Suspense fallback={<div className="skeleton h-40 w-full" />}>
          <EditDriver />
        </Suspense>
      )}
    </RequireOrganisation>
  );
}
