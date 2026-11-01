"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { Card } from "@/components/ui/card";

import { fetchTrips, TRIPS_KEY } from "./api";
import { TripRow } from "./trip-list";

const SHOWN = 5;

/** Shown on vehicle and driver pages. */
export function TripHistoryCard({ vehicleId, driverId }: { vehicleId?: string; driverId?: string }) {
  const filters = {
    search: "",
    status: "",
    vehicle: vehicleId ?? "",
    driver: driverId ?? "",
    page: 1,
  };
  const trips = useQuery({
    queryKey: [...TRIPS_KEY, "list", "recent", filters],
    queryFn: () => fetchTrips(filters, SHOWN),
  });
  const query = vehicleId ? `vehicle=${vehicleId}` : `driver=${driverId}`;

  return (
    <Card>
      <h2 className="text-lg font-semibold">Trip history</h2>
      {trips.isPending && <p className="mt-2 text-sm opacity-75">Loading trips…</p>}
      {trips.isError && <p className="mt-2 text-sm">Trips couldn&apos;t be loaded.</p>}
      {trips.data?.total === 0 && <p className="mt-2 text-sm opacity-75">No trips yet.</p>}
      {trips.data && trips.data.total > 0 && (
        <>
          <ul aria-label="Recent trips" className="mt-3 divide-y divide-base-300 border-y border-base-300">
            {trips.data.items.map((trip) => (
              <TripRow key={trip.id} trip={trip} />
            ))}
          </ul>
          {trips.data.total > SHOWN && (
            <Link href={`/trips?${query}`} className="link mt-3 inline-block text-sm">
              View all {trips.data.total} trips
            </Link>
          )}
        </>
      )}
    </Card>
  );
}
