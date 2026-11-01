"use client";

import { Suspense } from "react";

import { RequireOrganisation } from "@/features/organisation/require-organisation";
import { TripDetail } from "@/features/trips/trip-detail";

export default function TripPage() {
  return (
    <RequireOrganisation permission="trips.view">
      {(membership) => (
        <Suspense>
          <TripDetail membership={membership} />
        </Suspense>
      )}
    </RequireOrganisation>
  );
}
