"use client";

import { useQuery } from "@tanstack/react-query";
import { CircleAlert, TriangleAlert, Truck } from "lucide-react";
import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

import { ALERT_REFRESH_MS, fetchAlertSummary, SUMMARY_KEY } from "@/features/alerts/api";

import { type DashboardSummary, fetchDashboard } from "./api";

function Tile({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div className="rounded-box border border-base-300 bg-base-100 p-4">
      <dt className="text-sm opacity-75">{label}</dt>
      <dd className="mt-1 font-mono text-3xl font-medium tabular-nums">{value}</dd>
      {note && <dd className="mt-1 text-xs opacity-70">{note}</dd>}
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
}: {
  organisationName: string;
  canAddVehicles?: boolean;
  canViewAlerts?: boolean;
}) {
  const summary = useQuery({ queryKey: ["dashboard"], queryFn: fetchDashboard });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="mt-1 opacity-75">{organisationName}</p>
      </div>
      {canViewAlerts && <AlertsNotice />}
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
      {summary.data && !isEmpty(summary.data) && <Figures summary={summary.data} />}
    </div>
  );
}

function Figures({ summary: { vehicles, drivers, trips } }: { summary: DashboardSummary }) {
  return (
    <>
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {vehicles && <Tile label="Total vehicles" value={vehicles.total} />}
        {vehicles?.utilisation_percent != null && (
          <Tile
            label="Fleet utilisation"
            value={`${vehicles.utilisation_percent}%`}
            note="Active vehicles as a share of all vehicles"
          />
        )}
        {trips && (
          <Tile label="Trips in progress" value={trips.in_progress} note={`${trips.scheduled} scheduled`} />
        )}
        {drivers && (
          <Tile label="Drivers available" value={drivers.available} note={`of ${drivers.total} drivers`} />
        )}
      </dl>
      {vehicles && vehicles.total > 0 && <VehicleStatusBreakdown vehicles={vehicles} />}
      {drivers && <LicenceWarnings drivers={drivers} />}
    </>
  );
}
