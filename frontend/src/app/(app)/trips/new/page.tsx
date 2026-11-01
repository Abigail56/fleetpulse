"use client";

import { RequireOrganisation } from "@/features/organisation/require-organisation";
import { TripForm } from "@/features/trips/trip-form";

export default function NewTripPage() {
  return (
    <RequireOrganisation permission="trips.manage">
      {() => (
        <div className="flex max-w-3xl flex-col gap-6">
          <h1 className="text-3xl font-bold tracking-tight">New trip</h1>
          <TripForm />
        </div>
      )}
    </RequireOrganisation>
  );
}
