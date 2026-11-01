"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Plus, Wrench } from "lucide-react";
import { useEffect, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SelectInput, TextInput } from "@/components/ui/field";
import type { CurrentMembership } from "@/features/organisation/api";
import { formatMoney } from "@/lib/money";
import { useUrlFilters } from "@/lib/use-url-filters";

import {
  fetchSchedules,
  fetchSummary,
  fetchWorkOrders,
  MAINTENANCE_KEY,
  PAGE_SIZE,
  STATE_LABELS,
  STATUS_LABELS,
  TYPE_LABELS,
  WORK_ORDER_STATUSES,
  type WorkOrderFilters,
} from "./api";
import { ScheduleRow, WorkOrderRow } from "./rows";

const SEARCH_DELAY_MS = 300;

type Filters = WorkOrderFilters & { state: string };

function readFilters(params: URLSearchParams): Filters {
  return {
    state: params.get("state") ?? "",
    search: params.get("search") ?? "",
    status: params.get("status") ?? "",
    type: params.get("type") ?? "",
    vehicle: params.get("vehicle") ?? "",
    page: Math.max(1, Number(params.get("page")) || 1),
  };
}

function Tile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Card>
      <dt className="text-sm opacity-75">{label}</dt>
      <dd className="mt-1 text-2xl font-bold tabular-nums">{value}</dd>
    </Card>
  );
}

export function MaintenanceOverview({ membership }: { membership: CurrentMembership }) {
  const [filters, commitFilters] = useUrlFilters(readFilters);
  const [searchText, setSearchText] = useState(filters.search);
  const canManage = membership.permissions.includes("maintenance.manage");
  const unit = membership.organisation.distance_unit;
  const summary = useQuery({ queryKey: [...MAINTENANCE_KEY, "summary"], queryFn: fetchSummary });
  const schedules = useQuery({
    queryKey: [...MAINTENANCE_KEY, "schedules", filters.state, filters.vehicle],
    queryFn: () => fetchSchedules({ state: filters.state, vehicle: filters.vehicle }),
  });
  const orders = useQuery({
    queryKey: [...MAINTENANCE_KEY, "orders", filters],
    queryFn: () => fetchWorkOrders(filters),
    placeholderData: keepPreviousData,
  });

  function setFilters(changes: Partial<Filters>) {
    const next = { ...filters, page: 1, ...changes };
    const params = new URLSearchParams();
    if (next.state) params.set("state", next.state);
    if (next.search) params.set("search", next.search);
    if (next.status) params.set("status", next.status);
    if (next.type) params.set("type", next.type);
    if (next.vehicle) params.set("vehicle", next.vehicle);
    if (next.page > 1) params.set("page", String(next.page));
    commitFilters(next, params.toString());
  }

  useEffect(() => {
    if (searchText === filters.search) return;
    const timer = setTimeout(() => setFilters({ search: searchText }), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a change of text starts a search
  }, [searchText]);

  const totalOrders = orders.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(totalOrders / PAGE_SIZE));
  const ordersFiltered = Boolean(filters.search || filters.status || filters.type || filters.vehicle);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight">Maintenance</h1>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <ButtonLink href="/maintenance/schedules/new" variant="outline">
              <Plus aria-hidden className="size-4" />
              New schedule
            </ButtonLink>
            <ButtonLink href="/maintenance/work-orders/new">
              <Plus aria-hidden className="size-4" />
              New work order
            </ButtonLink>
          </div>
        )}
      </div>
      {summary.isError && <Alert variant="error">{summary.error.message}</Alert>}
      {summary.data && (
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label="Overdue" value={summary.data.overdue} />
          <Tile label="Due soon" value={summary.data.due_soon} />
          <Tile
            label="Work orders open or in progress"
            value={summary.data.open_work_orders + summary.data.in_progress_work_orders}
          />
          <Tile
            label="Recorded cost, last 30 days"
            value={
              summary.data.recent_costs.length === 0
                ? "None recorded"
                : summary.data.recent_costs
                    .map((cost) => formatMoney(cost.amount, cost.currency))
                    .join(" + ")
            }
          />
        </dl>
      )}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-xl font-semibold">Schedules</h2>
          <label className="flex flex-col gap-1 text-sm">
            Due status
            <SelectInput
              value={filters.state}
              onChange={(event) => setFilters({ state: event.target.value })}
            >
              <option value="">All</option>
              {(Object.keys(STATE_LABELS) as (keyof typeof STATE_LABELS)[]).map((state) => (
                <option key={state} value={state}>
                  {STATE_LABELS[state]}
                </option>
              ))}
            </SelectInput>
          </label>
        </div>
        {schedules.isPending && (
          <p role="status" className="text-sm opacity-75">
            Loading schedules…
          </p>
        )}
        {schedules.isError && <Alert variant="error">{schedules.error.message}</Alert>}
        {schedules.data?.total === 0 &&
          (filters.state ? (
            <p className="text-sm">No schedules match this filter.</p>
          ) : (
            <EmptyState
              icon={Wrench}
              title="No schedules yet"
              action={
                canManage ? (
                  <ButtonLink href="/maintenance/schedules/new">Create a schedule</ButtonLink>
                ) : undefined
              }
            >
              Set up recurring work, such as an oil change every 90 days or 10,000 km, and
              FleetPulse reminds you when it comes due.
            </EmptyState>
          ))}
        {schedules.data && schedules.data.total > 0 && (
          <Card className="overflow-hidden p-0">
            <ul aria-label="Schedules" className="divide-y divide-base-300">
              {schedules.data.items.map((schedule) => (
                <ScheduleRow key={schedule.id} schedule={schedule} unit={unit} />
              ))}
            </ul>
          </Card>
        )}
        {schedules.data && schedules.data.total > schedules.data.items.length && (
          <p className="text-xs opacity-75">
            Showing the {schedules.data.items.length} most urgent of {schedules.data.total}. Filter
            by due status to find others.
          </p>
        )}
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Work orders and service history</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm">
            Search
            <TextInput
              type="search"
              placeholder="Title, provider or vehicle"
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
              {WORK_ORDER_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABELS[status]}
                </option>
              ))}
            </SelectInput>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Type
            <SelectInput
              value={filters.type}
              onChange={(event) => setFilters({ type: event.target.value })}
            >
              <option value="">All</option>
              <option value="preventive">{TYPE_LABELS.preventive}</option>
              <option value="corrective">{TYPE_LABELS.corrective}</option>
            </SelectInput>
          </label>
          {ordersFiltered && (
            <Button
              variant="ghost"
              onClick={() => {
                setSearchText("");
                setFilters({ search: "", status: "", type: "", vehicle: "" });
              }}
            >
              Clear filters
            </Button>
          )}
        </div>
        {orders.isPending && (
          <p role="status" className="text-sm opacity-75">
            Loading work orders…
          </p>
        )}
        {orders.isError && (
          <div className="flex flex-col items-start gap-3">
            <Alert variant="error">{orders.error.message}</Alert>
            <Button variant="outline" onClick={() => void orders.refetch()}>
              Try again
            </Button>
          </div>
        )}
        {orders.data && totalOrders === 0 && (
          <p className="text-sm opacity-75">
            {ordersFiltered ? "No work orders match these filters." : "No work orders yet."}
          </p>
        )}
        {orders.data && totalOrders > 0 && (
          <>
            <Card className="overflow-hidden p-0">
              <ul aria-label="Work orders" className="divide-y divide-base-300">
                {orders.data.items.map((order) => (
                  <WorkOrderRow key={order.id} order={order} />
                ))}
              </ul>
            </Card>
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <span>
                {totalOrders} {totalOrders === 1 ? "work order" : "work orders"}
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
      </section>
    </div>
  );
}
