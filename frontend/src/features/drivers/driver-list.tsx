"use client";
"use no memo";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  createColumnHelper,
  flexRender,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, Plus, UserRound } from "lucide-react";
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
  AVAILABILITIES,
  AVAILABILITY_LABELS,
  type Driver,
  DRIVER_STATUSES,
  type DriverFilters,
  DRIVERS_KEY,
  fetchDrivers,
  PAGE_SIZE,
  STATUS_LABELS,
} from "./api";
import { availabilityLabel, DriverStatusBadge, LicenceExpiry } from "./driver-badges";

const SEARCH_DELAY_MS = 300;
const DEFAULT_SORT = "last_name";
const features = tableFeatures({});
const column = createColumnHelper<typeof features, Driver>();
const SORTABLE: Record<string, string> = {
  last_name: "last_name",
  licence_expires_on: "licence_expires_on",
  status: "status",
  availability: "availability",
};

function readFilters(params: URLSearchParams): DriverFilters {
  return {
    search: params.get("search") ?? "",
    status: params.get("status") ?? "",
    availability: params.get("availability") ?? "",
    licence: params.get("licence") ?? "",
    archived: params.get("archived") === "true",
    sort: params.get("sort") ?? DEFAULT_SORT,
    page: Math.max(1, Number(params.get("page")) || 1),
  };
}

export function DriverList({ membership }: { membership: CurrentMembership }) {
  const [filters, commitFilters] = useUrlFilters(readFilters);
  const [searchText, setSearchText] = useState(filters.search);
  const canManage = membership.permissions.includes("drivers.manage");
  const canSearchSensitive = membership.permissions.includes("drivers.view_sensitive");
  const drivers = useQuery({
    queryKey: [...DRIVERS_KEY, "list", filters],
    queryFn: () => fetchDrivers(filters),
    placeholderData: keepPreviousData,
  });

  function setFilters(changes: Partial<DriverFilters>) {
    const next = { ...filters, page: 1, ...changes };
    const params = new URLSearchParams();
    if (next.search) params.set("search", next.search);
    if (next.status) params.set("status", next.status);
    if (next.availability) params.set("availability", next.availability);
    if (next.licence) params.set("licence", next.licence);
    if (next.archived) params.set("archived", "true");
    if (next.sort !== DEFAULT_SORT) params.set("sort", next.sort);
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
    column.accessor("last_name", {
      header: "Name",
      cell: ({ row }) => (
        <Link
          href={`/drivers/${row.original.id}`}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          {row.original.first_name} {row.original.last_name}
        </Link>
      ),
    }),
    column.accessor("licence_number", {
      header: "Licence",
      cell: ({ getValue }) => <span className="font-mono text-sm">{getValue()}</span>,
    }),
    column.accessor("licence_expires_on", {
      header: "Licence expiry",
      cell: ({ getValue }) => <LicenceExpiry date={getValue()} />,
    }),
    column.accessor("status", {
      header: "Status",
      cell: ({ row }) => <DriverStatusBadge driver={row.original} />,
    }),
    column.accessor("availability", {
      header: "Availability",
      cell: ({ row }) => availabilityLabel(row.original),
    }),
    column.accessor("current_vehicle", {
      header: "Vehicle",
      cell: ({ getValue }) => getValue()?.registration_number ?? "None",
    }),
  ]);

  const table = useTable<typeof features, Driver>({
    features,
    data: drivers.data?.items ?? [],
    columns,
    getRowId: (row) => row.id,
  });

  const total = drivers.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Boolean(
    filters.search || filters.status || filters.availability || filters.licence,
  );

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
        <h1 className="text-3xl font-bold tracking-tight">Drivers</h1>
        {canManage && (
          <ButtonLink href="/drivers/new">
            <Plus aria-hidden className="size-4" />
            Add driver
          </ButtonLink>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_auto] lg:items-center">
        <TextInput
          type="search"
          aria-label="Search drivers"
          placeholder={canSearchSensitive ? "Search name, licence, phone or email" : "Search name"}
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
        />
        <SelectInput
          aria-label="Filter by status"
          value={filters.status}
          onChange={(event) => setFilters({ status: event.target.value })}
        >
          <option value="">All statuses</option>
          {DRIVER_STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </SelectInput>
        <SelectInput
          aria-label="Filter by availability"
          value={filters.availability}
          onChange={(event) => setFilters({ availability: event.target.value })}
        >
          <option value="">All availability</option>
          {AVAILABILITIES.map((value) => (
            <option key={value} value={value}>
              {AVAILABILITY_LABELS[value]}
            </option>
          ))}
        </SelectInput>
        <SelectInput
          aria-label="Filter by licence"
          value={filters.licence}
          onChange={(event) => setFilters({ licence: event.target.value })}
        >
          <option value="">All licences</option>
          <option value="expired">Expired</option>
          <option value="expiring">Expiring within 30 days</option>
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

      {drivers.isPending && (
        <div role="status" aria-label="Loading drivers" className="flex flex-col gap-2">
          <div className="skeleton h-12 w-full" />
          <div className="skeleton h-12 w-full" />
        </div>
      )}
      {drivers.isError && (
        <div className="flex flex-col items-start gap-3">
          <Alert variant="error">{drivers.error.message}</Alert>
          <Button variant="outline" onClick={() => drivers.refetch()}>
            Try again
          </Button>
        </div>
      )}
      {drivers.isSuccess && total === 0 && (
        <EmptyState
          icon={UserRound}
          title={
            filtered ? "No drivers match" : filters.archived ? "No archived drivers" : "No drivers yet"
          }
          action={
            !filtered && !filters.archived && canManage ? (
              <ButtonLink href="/drivers/new">Add your first driver</ButtonLink>
            ) : undefined
          }
        >
          {filtered
            ? "Try a different search or clear the filters."
            : filters.archived
              ? "Drivers you archive will appear here."
              : canManage
                ? "Add a driver to track licences and assign them to vehicles."
                : "Drivers will appear here once they've been added."}
        </EmptyState>
      )}
      {drivers.isSuccess && total > 0 && (
        <Card className="p-0">
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Drivers table">
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
              {total} {total === 1 ? "driver" : "drivers"}
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
