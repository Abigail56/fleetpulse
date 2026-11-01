"use client";

import { DriverForm } from "@/features/drivers/driver-form";
import { RequireOrganisation } from "@/features/organisation/require-organisation";

export default function NewDriverPage() {
  return (
    <RequireOrganisation permission="drivers.manage">
      {() => (
        <div className="flex max-w-3xl flex-col gap-6">
          <h1 className="text-3xl font-bold tracking-tight">Add a driver</h1>
          <DriverForm />
        </div>
      )}
    </RequireOrganisation>
  );
}
