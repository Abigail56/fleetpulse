"use client";
"use no memo";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  createColumnHelper,
  flexRender,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, Plus, Truck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SelectInput, TextInput } from "@/components/ui/field";
import type { CurrentMembership } from "@/features/organisation/api";
import { formatDistance } from "@/lib/distance";
import { useUrlFilters } from "@/lib/use-url-filters";

import {
  fetchVehicles,
  PAGE_SIZE,
  STATUS_LABELS,
  TYPE_LABELS,
  type Vehicle,
  VEHICLE_STATUSES,
  VEHICLE_TYPES,
  type VehicleFilters,
  VEHICLES_KEY,
} from "./api";
import { VehicleStatusBadge } from "./vehicle-status-badge";

const SEARCH_DELAY_MS = 300;
const features = tableFeatures({});
const column = createColumnHelper<typeof features, Vehicle>();
const SORTABLE: Record<string, string> = {
  registration_number: "registration_number",
  year: "year",
  odometer_km: "odometer_km",
  status: "status",
};

function readFilters(params: URLSearchParams): VehicleFilters {
  return {
    search: params.get("search") ?? "",
    status: params.get("status") ?? "",
    vehicle_type: params.get("vehicle_type") ?? "",
    archived: params.get("archived") === "true",
    sort: params.get("sort") ?? "registration_number",
    page: Math.max(1, Number(params.get("page")) || 1),
  };
}

/** Filters live in the URL, so a filtered list can be shared and survives Back. */
export function VehicleList({ membership }: { membership: CurrentMembership }) {
  const [filters, commitFilters] = useUrlFilters(readFilters);
  const [searchText, setSearchText] = useState(filters.search);
  const unit = membership.organisation.distance_unit;
  const canManage = membership.permissions.includes("vehicles.manage");
  const vehicles = useQuery({
    queryKey: [...VEHICLES_KEY, "list", filters],
    queryFn: () => fetchVehicles(filters),
    placeholderData: keepPreviousData,
  });

  function setFilters(changes: Partial<VehicleFilters>) {
    const next = { ...filters, page: 1, ...changes };
    const params = new URLSearchParams();
    if (next.search) params.set("search", next.search);
    if (next.status) params.set("status", next.status);
    if (next.vehicle_type) params.set("vehicle_type", next.vehicle_type);
    if (next.archived) params.set("archived", "true");
    if (next.sort !== "registration_number") params.set("sort", next.sort);
    if (next.page > 1) params.set("page", String(next.page));
    commitFilters(next, params.toString());
  }

  useEffect(() => {
    if (searchText === filters.search) return;
    const timer = setTimeout(() => setFilters({ search: searchText }), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
    // Only the typed text should restart the delay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText]);

  const columns = column.columns([
    column.accessor("registration_number", {
      header: "Registration",
      cell: ({ row }) => (
        <Link
          href={`/vehicles/${row.original.id}`}
          className="font-mono font-medium text-primary underline-offset-4 hover:underline"
        >
          {row.original.registration_number}
        </Link>
      ),
    }),
    column.accessor("make", {
      header: "Vehicle",
      cell: ({ row }) => `${row.original.make} ${row.original.model}`,
    }),
    column.accessor("vehicle_type", {
      header: "Type",
      cell: ({ getValue }) => TYPE_LABELS[getValue()],
    }),
    column.accessor("year", {
      header: "Year",
      cell: ({ getValue }) => getValue() ?? "—",
    }),
    column.accessor("odometer_km", {
      header: "Odometer",
      cell: ({ getValue }) => (
        <span className="font-mono tabular-nums">{formatDistance(Number(getValue()), unit)}</span>
      ),
    }),
    column.accessor("status", {
      header: "Status",
      cell: ({ row }) => <VehicleStatusBadge vehicle={row.original} />,
    }),
  ]);

  const table = useTable<typeof features, Vehicle>({
    features,
    data: vehicles.data?.items ?? [],
    columns,
    getRowId: (row) => row.id,
  });

  const total = vehicles.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Boolean(filters.search || filters.status || filters.vehicle_type);

  function sortHeader(id: string, label: React.ReactNode) {
    const field = SORTABLE[id];
    if (!field) return label;
    const ascending = filters.sort === field;
    const descending = filters.sort === `-${field}`;
    return (
      <button
        type="button"
        className="inline-flex items-center gap-1 font-semibold hover:underline"
        onClick={() => setFilters({ sort: ascending ? `-${field}` : field })}
      >
        {label}
        {ascending && <ArrowUp aria-hidden className="size-3.5" />}
        {descending && <ArrowDown aria-hidden className="size-3.5" />}
      </button>
    );
  }

  function ariaSort(id: string) {
    const field = SORTABLE[id];
    if (!field) return undefined;
    if (filters.sort === field) return "ascending";
    if (filters.sort === `-${field}`) return "descending";
    return "none";
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight">Vehicles</h1>
        {canManage && (
          <ButtonLink href="/vehicles/new">
            <Plus aria-hidden className="size-4" />
            Add vehicle
          </ButtonLink>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_auto] lg:items-center">
        <TextInput
          type="search"
          aria-label="Search vehicles"
          placeholder="Search registration, make, model or VIN"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
        />
        <SelectInput
          aria-label="Filter by status"
          value={filters.status}
          onChange={(event) => setFilters({ status: event.target.value })}
        >
          <option value="">All statuses</option>
          {VEHICLE_STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </SelectInput>
        <SelectInput
          aria-label="Filter by type"
          value={filters.vehicle_type}
          onChange={(event) => setFilters({ vehicle_type: event.target.value })}
        >
          <option value="">All types</option>
          {VEHICLE_TYPES.map((type) => (
            <option key={type} value={type}>
              {TYPE_LABELS[type]}
            </option>
          ))}
        </SelectInput>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="checkbox checkbox-sm"
            checked={filters.archived}
            onChange={(event) => setFilters({ archived: event.target.checked })}
          />
          Show archived
        </label>
      </div>

      {vehicles.isPending && (
        <div role="status" aria-label="Loading vehicles" className="flex flex-col gap-2">
          <div className="skeleton h-12 w-full" />
          <div className="skeleton h-12 w-full" />
          <div className="skeleton h-12 w-full" />
        </div>
      )}
      {vehicles.isError && (
        <div className="flex flex-col items-start gap-3">
          <Alert variant="error">{vehicles.error.message}</Alert>
          <Button variant="outline" onClick={() => vehicles.refetch()}>
            Try again
          </Button>
        </div>
      )}
      {vehicles.isSuccess && total === 0 && (
        <EmptyState
          icon={Truck}
          title={
            filtered
              ? "No vehicles match"
              : filters.archived
                ? "No archived vehicles"
                : "No vehicles yet"
          }
          action={
            !filtered && !filters.archived && canManage ? (
              <ButtonLink href="/vehicles/new">Add your first vehicle</ButtonLink>
            ) : undefined
          }
        >
          {filtered
            ? "Try a different search or clear the filters."
            : filters.archived
              ? "Vehicles you archive will appear here."
              : canManage
                ? "Add a vehicle to start building your fleet record."
                : "Vehicles will appear here once they've been added."}
        </EmptyState>
      )}
      {vehicles.isSuccess && total > 0 && (
        <Card className="p-0">
          <div
            className="overflow-x-auto"
            tabIndex={0}
            role="region"
            aria-label="Vehicles table"
          >
            <table className="table">
              <thead>
                {table.getHeaderGroups().map((group) => (
                  <tr key={group.id}>
                    {group.headers.map((header) => (
                      <th
                        key={header.id}
                        scope="col"
                        className="text-base-content"
                        aria-sort={ariaSort(header.column.id)}
                      >
                        {sortHeader(
                          header.column.id,
                          flexRender(header.column.columnDef.header, header.getContext()),
                        )}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((row) => (
                  <tr key={row.id}>
                    {row.getAllCells().map((cell) => (
                      <td key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-base-300 p-4 text-sm">
            <p role="status">
              {total} {total === 1 ? "vehicle" : "vehicles"}
              {pageCount > 1 && `, page ${filters.page} of ${pageCount}`}
            </p>
            {pageCount > 1 && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  disabled={filters.page <= 1}
                  onClick={() => setFilters({ page: filters.page - 1 })}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  disabled={filters.page >= pageCount}
                  onClick={() => setFilters({ page: filters.page + 1 })}
                >
                  Next
                </Button>
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
