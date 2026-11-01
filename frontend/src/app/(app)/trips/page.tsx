"use client";

import { Suspense } from "react";

import { RequireOrganisation } from "@/features/organisation/require-organisation";
import { TripList } from "@/features/trips/trip-list";

export default function TripsPage() {
  return (
    <RequireOrganisation permission="trips.view">
      {(membership) => (
        <Suspense>
          <TripList membership={membership} />
        </Suspense>
      )}
    </RequireOrganisation>
  );
}
