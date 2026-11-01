"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Plus, Route } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SelectInput, TextInput } from "@/components/ui/field";
import type { CurrentMembership } from "@/features/organisation/api";
import { useUrlFilters } from "@/lib/use-url-filters";

import {
  fetchTrips,
  PAGE_SIZE,
  STATUS_LABELS,
  type Trip,
  TRIP_STATUSES,
  type TripFilters,
  TRIPS_KEY,
} from "./api";
import { TripStatusBadge } from "./trip-badges";

const SEARCH_DELAY_MS = 300;

function readFilters(params: URLSearchParams): TripFilters {
  return {
    search: params.get("search") ?? "",
    status: params.get("status") ?? "",
    vehicle: params.get("vehicle") ?? "",
    driver: params.get("driver") ?? "",
    page: Math.max(1, Number(params.get("page")) || 1),
  };
}

export function departureLabel(trip: Trip) {
  if (trip.actual_departure_at) {
    return `Departed ${format(new Date(trip.actual_departure_at), "d MMM yyyy, HH:mm")}`;
  }
  if (trip.planned_departure_at) {
    return `Planned ${format(new Date(trip.planned_departure_at), "d MMM yyyy, HH:mm")}`;
  }
  return "No departure time";
}

export function TripRow({ trip }: { trip: Trip }) {
  return (
    <li>
      <Link href={`/trips/${trip.id}`} className="block px-4 py-3 transition-colors hover:bg-base-200">
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium">
            {trip.origin_name} → {trip.destination_name}
          </span>
          <TripStatusBadge status={trip.status} />
        </span>
        <span className="mt-1 block text-xs opacity-75">
          {trip.vehicle_registration ?? "No vehicle"} · {trip.driver_name ?? "No driver"} ·{" "}
          {departureLabel(trip)}
        </span>
      </Link>
    </li>
  );
}

export function TripList({ membership }: { membership: CurrentMembership }) {
  const [filters, commitFilters] = useUrlFilters(readFilters);
  const [searchText, setSearchText] = useState(filters.search);
  const canManage = membership.permissions.includes("trips.manage");
  const seesAll = membership.permissions.includes("trips.view_all");
  const trips = useQuery({
    queryKey: [...TRIPS_KEY, "list", filters],
    queryFn: () => fetchTrips(filters),
    placeholderData: keepPreviousData,
  });

  function setFilters(changes: Partial<TripFilters>) {
    const next = { ...filters, page: 1, ...changes };
    const params = new URLSearchParams();
    if (next.search) params.set("search", next.search);
    if (next.status) params.set("status", next.status);
    if (next.vehicle) params.set("vehicle", next.vehicle);
    if (next.driver) params.set("driver", next.driver);
    if (next.page > 1) params.set("page", String(next.page));
    commitFilters(next, params.toString());
  }

  useEffect(() => {
    if (searchText === filters.search) return;
    const timer = setTimeout(() => setFilters({ search: searchText }), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a change of text starts a search
  }, [searchText]);

  const filtered = Boolean(filters.search || filters.status || filters.vehicle || filters.driver);
  const total = trips.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight">{seesAll ? "Trips" : "My trips"}</h1>
        {canManage && (
          <ButtonLink href="/trips/new">
            <Plus aria-hidden className="size-4" />
            New trip
          </ButtonLink>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm">
          Search
          <TextInput
            type="search"
            placeholder="Place, vehicle or driver"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Status
          <SelectInput
            value={filters.status}
            onChange={(event) => setFilters({ status: event.target.value })}
          >
            <option value="">All</option>
            {TRIP_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </SelectInput>
        </label>
        {filtered && (
          <Button
            variant="ghost"
            onClick={() => {
              setSearchText("");
              setFilters({ search: "", status: "", vehicle: "", driver: "" });
            }}
          >
            Clear filters
          </Button>
        )}
      </div>
      {trips.isPending && (
        <p role="status" className="text-sm opacity-75">
          Loading trips…
        </p>
      )}
      {trips.isError && (
        <div className="flex flex-col items-start gap-3">
          <Alert variant="error">{trips.error.message}</Alert>
          <Button variant="outline" onClick={() => void trips.refetch()}>
            Try again
          </Button>
        </div>
      )}
      {trips.data && total === 0 && !filtered && (
        <EmptyState
          icon={Route}
          title={seesAll ? "No trips yet" : "No trips assigned to you"}
          action={canManage ? <ButtonLink href="/trips/new">Create a trip</ButtonLink> : undefined}
        >
          {seesAll
            ? "Trips you plan and dispatch will appear here."
            : "If you expected to see trips here, ask your fleet manager to link your account to your driver record."}
        </EmptyState>
      )}
      {trips.data && total === 0 && filtered && (
        <p className="text-sm">No trips match these filters.</p>
      )}
      {trips.data && total > 0 && (
        <>
          <Card className="overflow-hidden p-0">
            <ul aria-label="Trips" className="divide-y divide-base-300">
              {trips.data.items.map((trip) => (
                <TripRow key={trip.id} trip={trip} />
              ))}
            </ul>
          </Card>
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <span>
              {total} {total === 1 ? "trip" : "trips"}
            </span>
            {pages > 1 && (
              <span className="flex items-center gap-2">
                <Button
                  variant="outline"
                  disabled={filters.page <= 1}
                  onClick={() => setFilters({ page: filters.page - 1 })}
                >
                  Previous
                </Button>
                Page {filters.page} of {pages}
                <Button
                  variant="outline"
                  disabled={filters.page >= pages}
                  onClick={() => setFilters({ page: filters.page + 1 })}
                >
                  Next
                </Button>
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
