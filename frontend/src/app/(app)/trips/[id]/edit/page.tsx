"use client";

import { Suspense } from "react";

import { RequireOrganisation } from "@/features/organisation/require-organisation";
import { EditTrip } from "@/features/trips/trip-detail";

export default function EditTripPage() {
  return (
    <RequireOrganisation permission="trips.manage">
      {() => (
        <Suspense>
          <EditTrip />
        </Suspense>
      )}
    </RequireOrganisation>
  );
}
