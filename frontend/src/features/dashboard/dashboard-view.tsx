"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  CircleAlert,
  Gauge,
  MapPinned,
  Route,
  TriangleAlert,
  Truck,
  UserRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

import { ALERT_REFRESH_MS, fetchAlertSummary, SUMMARY_KEY } from "@/features/alerts/api";
import {
  fetchSummary as fetchMaintenanceSummary,
  MAINTENANCE_KEY,
} from "@/features/maintenance/api";

import { type DashboardSummary, fetchDashboard } from "./api";

function Tile({
  label,
  value,
  note,
  href,
  icon: Icon,
  accent,
  frame,
}: {
  label: string;
  value: string | number;
  note?: string;
  href?: string;
  icon: LucideIcon;
  accent: string;
  frame: string;
}) {
  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <dt className="text-sm font-medium text-base-content/70">{label}</dt>
        <span className={`grid size-9 place-items-center rounded-field ${accent}`}>
          <Icon aria-hidden className="size-[18px]" />
        </span>
      </div>
      <dd className="mt-3 font-metric text-3xl font-semibold tracking-tight tabular-nums sm:text-4xl">
        {value}
      </dd>
      {note && <dd className="mt-1 text-xs text-base-content/65">{note}</dd>}
    </>
  );
  const className = `group relative min-h-36 overflow-hidden rounded-box border border-base-300 border-t-4 bg-base-100 p-5 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary/10 motion-reduce:transition-none ${frame}`;

  const card = (
    <dl>
      <div>{content}</div>
    </dl>
  );

  if (href) {
    return (
      <Link href={href} className={`${className} block focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary`}>
        {card}
        <span className="sr-only">View {label.toLowerCase()}</span>
        <ArrowUpRight
          aria-hidden
          className="absolute bottom-4 right-4 size-4 text-base-content/35 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary"
        />
      </Link>
    );
  }

  return (
    <div className={className}>
      {card}
    </div>
  );
}

const STATUS_SEGMENTS = [
  { key: "active", label: "Active", color: "var(--color-success)" },
  { key: "idle", label: "Idle", color: "var(--color-secondary)" },
  { key: "maintenance", label: "In maintenance", color: "var(--color-warning)" },
  { key: "out_of_service", label: "Out of service", color: "var(--color-error)" },
] as const;

function VehicleStatusBreakdown({
  vehicles,
}: {
  vehicles: NonNullable<DashboardSummary["vehicles"]>;
}) {
  const present = STATUS_SEGMENTS.filter((segment) => vehicles[segment.key] > 0);
  return (
    <Card>
      <h2 className="text-lg font-semibold">Vehicles by status</h2>
      <div aria-hidden className="mt-4 flex h-3 gap-0.5">
        {present.map(({ key, label, color }) => (
          <div
            key={key}
            title={`${label}: ${vehicles[key]}`}
            className="min-w-1 rounded-sm"
            style={{ flexGrow: vehicles[key], background: color }}
          />
        ))}
      </div>
      {/* The figures themselves, so nothing depends on seeing the bar or telling its colours apart. */}
      <ul className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {STATUS_SEGMENTS.map(({ key, label, color }) => (
          <li key={key} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2">
              <span aria-hidden className="size-2.5 rounded-sm" style={{ background: color }} />
              {label}
            </span>
            <span className="font-mono tabular-nums">{vehicles[key]}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function LicenceWarnings({ drivers }: { drivers: NonNullable<DashboardSummary["drivers"]> }) {
  const { licences_expired: expired, licences_expiring_soon: expiring } = drivers;
  if (expired === 0 && expiring === 0) return null;
  return (
    <Card>
      <h2 className="text-lg font-semibold">Needs attention</h2>
      <ul className="mt-3 flex flex-col gap-2 text-sm">
        {expired > 0 && (
          <li className="flex items-center gap-2">
            <CircleAlert aria-hidden className="size-4 text-error" />
            <Link href="/drivers?licence=expired" className="link">
              {expired} driver {expired === 1 ? "licence has" : "licences have"} expired
            </Link>
          </li>
        )}
        {expiring > 0 && (
          <li className="flex items-center gap-2">
            <TriangleAlert aria-hidden className="size-4" />
            <Link href="/drivers?licence=expiring" className="link">
              {expiring} driver {expiring === 1 ? "licence expires" : "licences expire"} within 30 days
            </Link>
          </li>
        )}
      </ul>
    </Card>
  );
}

function isEmpty({ vehicles, drivers, trips }: DashboardSummary) {
  return (
    (vehicles?.total ?? 0) === 0 &&
    (drivers?.total ?? 0) === 0 &&
    (trips?.in_progress ?? 0) === 0 &&
    (trips?.scheduled ?? 0) === 0
  );
}

/** Only appears when something needs attention. */
function AlertsNotice() {
  const summary = useQuery({
    queryKey: SUMMARY_KEY,
    queryFn: fetchAlertSummary,
    refetchInterval: ALERT_REFRESH_MS,
  });
  const count = summary.data?.unacknowledged ?? 0;
  if (count === 0) return null;
  return (
    <Alert variant={summary.data?.critical ? "error" : "info"}>
      <Link href="/alerts" className="link">
        {count} {count === 1 ? "alert needs" : "alerts need"} attention
        {summary.data?.critical ? `, including ${summary.data.critical} critical` : ""}
      </Link>
    </Alert>
  );
}

export function DashboardView({
  organisationName,
  canAddVehicles = false,
  canViewAlerts = false,
  permissions = [],
}: {
  organisationName: string;
  canAddVehicles?: boolean;
  canViewAlerts?: boolean;
  permissions?: string[];
}) {
  const summary = useQuery({ queryKey: ["dashboard"], queryFn: fetchDashboard });
  const maintenance = useQuery({
    queryKey: [...MAINTENANCE_KEY, "summary"],
    queryFn: fetchMaintenanceSummary,
    enabled: permissions.includes("maintenance.view"),
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            Fleet operations
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Dashboard</h1>
          <p className="mt-1 text-sm text-base-content/65">{organisationName}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {permissions.includes("vehicles.view") && (
            <ButtonLink href="/map" variant="outline" className="gap-2">
              <MapPinned aria-hidden className="size-4" />
              Live map
            </ButtonLink>
          )}
          {canAddVehicles && (
            <ButtonLink href="/vehicles/new" className="gap-2">
              <Truck aria-hidden className="size-4" />
              Add vehicle
            </ButtonLink>
          )}
        </div>
      </div>
      {canViewAlerts && <AlertsNotice />}
      {maintenance.isError && (
        <Alert variant="error">Maintenance summary: {maintenance.error.message}</Alert>
      )}
      {summary.isPending && (
        <div role="status" aria-label="Loading dashboard" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="skeleton h-24" />
          ))}
        </div>
      )}
      {summary.isError && (
        <div className="flex flex-col items-start gap-3">
          <Alert variant="error">{summary.error.message}</Alert>
          <Button variant="outline" onClick={() => summary.refetch()}>
            Try again
          </Button>
        </div>
      )}
      {summary.data && isEmpty(summary.data) && (
        <EmptyState
          icon={Truck}
          title="Nothing to report yet"
          action={
            canAddVehicles ? <ButtonLink href="/vehicles/new">Add your first vehicle</ButtonLink> : undefined
          }
        >
          This dashboard shows real figures from your organisation&apos;s records, and they&apos;ll
          appear here as vehicles and drivers are added.
        </EmptyState>
      )}
      {summary.data && !isEmpty(summary.data) && (
        <Figures
          summary={summary.data}
          permissions={permissions}
          maintenance={maintenance.data}
        />
      )}
    </div>
  );
}

function Figures({
  summary: { vehicles, drivers, trips },
  permissions,
  maintenance,
}: {
  summary: DashboardSummary;
  permissions: string[];
  maintenance?: {
    overdue: number;
    due_soon: number;
    open_work_orders: number;
    in_progress_work_orders: number;
  };
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-base-content/55">
          Fleet overview
        </h2>
        <section
          aria-label="Fleet overview metrics"
          className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
        >
          {vehicles && (
            <Tile
              label="Total vehicles"
              value={vehicles.total}
              note="Registered in your fleet"
              icon={Truck}
              accent="bg-primary/10 text-primary"
              frame="border-t-primary"
              href={permissions.includes("vehicles.view") ? "/vehicles" : undefined}
            />
          )}
          {vehicles && (
            <Tile
              label="Active vehicles"
              value={vehicles.active}
              note={`${vehicles.idle} idle · ${vehicles.maintenance} in maintenance`}
              icon={Gauge}
              accent="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              frame="border-t-emerald-500"
              href={permissions.includes("vehicles.view") ? "/vehicles?status=active" : undefined}
            />
          )}
          {vehicles?.utilisation_percent != null && (
            <Tile
              label="Fleet utilisation"
              value={`${vehicles.utilisation_percent}%`}
              note="Active vehicles as a share of all vehicles"
              icon={MapPinned}
              accent="bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"
              frame="border-t-cyan-500"
            />
          )}
          {drivers && (
            <Tile
              label="Drivers available"
              value={drivers.available}
              note={`of ${drivers.total} drivers`}
              icon={UserRound}
              accent="bg-violet-500/10 text-violet-700 dark:text-violet-300"
              frame="border-t-violet-500"
              href={permissions.includes("drivers.view") ? "/drivers" : undefined}
            />
          )}
        </section>
      </div>
      {trips && (
        <Card className="flex flex-col justify-between gap-4 border-primary/20 bg-primary/[0.04] sm:flex-row sm:items-center">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-field bg-primary/10 text-primary">
              <Route aria-hidden className="size-5" />
            </span>
            <div>
              <h2 className="font-semibold">Trips in progress</h2>
              <p className="mt-1 font-metric text-2xl font-semibold tabular-nums">
                {trips.in_progress}
              </p>
              <p className="mt-1 text-sm text-base-content/70">
                {trips.scheduled} scheduled
              </p>
            </div>
          </div>
          {permissions.includes("trips.view") && (
            <ButtonLink href="/trips" variant="outline" className="shrink-0">
              View trips
            </ButtonLink>
          )}
        </Card>
      )}
      {maintenance && (
        <Card className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-field bg-amber-500/10 text-amber-700 dark:text-amber-300">
              <TriangleAlert aria-hidden className="size-5" />
            </span>
            <div>
              <h2 className="font-semibold">Maintenance attention</h2>
              <p className="mt-1 text-sm text-base-content/70">
                {maintenance.overdue} overdue · {maintenance.due_soon} due soon ·{" "}
                {maintenance.open_work_orders + maintenance.in_progress_work_orders} open work
                orders
              </p>
            </div>
          </div>
          {permissions.includes("maintenance.view") && (
            <ButtonLink href="/maintenance" variant="outline" className="shrink-0">
              Review maintenance
            </ButtonLink>
          )}
        </Card>
      )}
      {vehicles && vehicles.total > 0 && <VehicleStatusBreakdown vehicles={vehicles} />}
      {drivers && <LicenceWarnings drivers={drivers} />}
    </div>
  );
}
