"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { BellOff } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SelectInput } from "@/components/ui/field";
import { type Status, StatusBadge } from "@/components/ui/status-badge";
import type { CurrentMembership } from "@/features/organisation/api";
import { useUrlFilters } from "@/lib/use-url-filters";

import {
  acknowledgeAlert,
  ALERT_REFRESH_MS,
  ALERT_TYPES,
  type AlertFilters,
  type AlertItem,
  ALERTS_KEY,
  fetchAlerts,
  PAGE_SIZE,
  resolveAlert,
  SEVERITIES,
  SEVERITY_LABELS,
  type Severity,
  STATES,
  TYPE_LABELS,
} from "./api";
import { AlertSettingsCard } from "./alert-settings-card";

const DEFAULT_STATE = "active";
const SEVERITY_STYLES: Record<Severity, Status> = {
  critical: "error",
  warning: "warning",
  info: "info",
};

function readFilters(params: URLSearchParams): AlertFilters {
  return {
    state: params.get("state") ?? DEFAULT_STATE,
    type: params.get("type") ?? "",
    severity: params.get("severity") ?? "",
    page: Math.max(1, Number(params.get("page")) || 1),
  };
}

function AlertRow({ alert, canManage }: { alert: AlertItem; canManage: boolean }) {
  const queryClient = useQueryClient();
  const change = useMutation({
    mutationFn: (action: () => Promise<AlertItem>) => action(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ALERTS_KEY });
    },
    onError: (error) => toast.error(error.message),
  });
  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{alert.title}</span>
        <span className="flex flex-wrap items-center gap-1.5">
          {alert.is_simulated && <StatusBadge status="info">Simulated</StatusBadge>}
          <StatusBadge status={SEVERITY_STYLES[alert.severity]}>
            {SEVERITY_LABELS[alert.severity]}
          </StatusBadge>
        </span>
      </div>
      <p className="text-sm opacity-85">{alert.message}</p>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs opacity-75">
        <span className="tabular-nums">
          {format(new Date(alert.occurred_at), "d MMM yyyy, HH:mm")}
        </span>
        <span>{TYPE_LABELS[alert.alert_type]}</span>
        {alert.resolved_at && <span>Resolved</span>}
        {alert.acknowledged_at && <span>Acknowledged</span>}
        {alert.vehicle_id && (
          <Link href={`/vehicles/${alert.vehicle_id}`} className="link">
            Open vehicle
          </Link>
        )}
        {alert.driver_id && (
          <Link href={`/drivers/${alert.driver_id}`} className="link">
            Open driver
          </Link>
        )}
        {alert.geofence_id && (
          <Link href={`/geofences/${alert.geofence_id}`} className="link">
            Open geofence
          </Link>
        )}
      </p>
      {canManage && !alert.resolved_at && (
        <div className="flex flex-wrap gap-2">
          {!alert.acknowledged_at && (
            <Button
              variant="outline"
              disabled={change.isPending}
              aria-label={`Acknowledge: ${alert.title}`}
              onClick={() => change.mutate(() => acknowledgeAlert(alert.id))}
            >
              Acknowledge
            </Button>
          )}
          <Button
            variant="ghost"
            disabled={change.isPending}
            aria-label={`Resolve: ${alert.title}`}
            onClick={() => change.mutate(() => resolveAlert(alert.id))}
          >
            Resolve
          </Button>
        </div>
      )}
    </li>
  );
}

export function AlertList({ membership }: { membership: CurrentMembership }) {
  const [filters, commitFilters] = useUrlFilters(readFilters);
  const canManage = membership.permissions.includes("alerts.manage");
  const canConfigure = membership.permissions.includes("geofences.manage");
  const alerts = useQuery({
    queryKey: [...ALERTS_KEY, "list", filters],
    queryFn: () => fetchAlerts(filters),
    placeholderData: keepPreviousData,
    refetchInterval: ALERT_REFRESH_MS,
  });

  function setFilters(changes: Partial<AlertFilters>) {
    const next = { ...filters, page: 1, ...changes };
    const params = new URLSearchParams();
    if (next.state !== DEFAULT_STATE) params.set("state", next.state);
    if (next.type) params.set("type", next.type);
    if (next.severity) params.set("severity", next.severity);
    if (next.page > 1) params.set("page", String(next.page));
    commitFilters(next, params.toString());
  }

  const total = alerts.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = filters.state !== DEFAULT_STATE || filters.type || filters.severity;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold tracking-tight">Alerts</h1>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Show
          <SelectInput
            value={filters.state}
            onChange={(event) => setFilters({ state: event.target.value })}
          >
            {STATES.map((state) => (
              <option key={state.value} value={state.value}>
                {state.label}
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
            <option value="">All types</option>
            {ALERT_TYPES.map((type) => (
              <option key={type} value={type}>
                {TYPE_LABELS[type]}
              </option>
            ))}
          </SelectInput>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Severity
          <SelectInput
            value={filters.severity}
            onChange={(event) => setFilters({ severity: event.target.value })}
          >
            <option value="">All severities</option>
            {SEVERITIES.map((severity) => (
              <option key={severity} value={severity}>
                {SEVERITY_LABELS[severity]}
              </option>
            ))}
          </SelectInput>
        </label>
      </div>
      {alerts.isPending && (
        <p role="status" className="text-sm opacity-75">
          Loading alerts…
        </p>
      )}
      {alerts.isError && !alerts.data && (
        <div className="flex flex-col items-start gap-3">
          <Alert variant="error">{alerts.error.message}</Alert>
          <Button variant="outline" onClick={() => void alerts.refetch()}>
            Try again
          </Button>
        </div>
      )}
      {alerts.isError && alerts.data && (
        <Alert variant="error">
          Alerts couldn&apos;t be refreshed. Showing the last ones received, and trying again.
        </Alert>
      )}
      {alerts.data && total === 0 && (
        <EmptyState icon={BellOff} title={filtered ? "No matching alerts" : "No active alerts"}>
          {filtered
            ? "Try different filters."
            : "Nothing needs attention right now. Alerts depend on your geofences, settings and incoming GPS data."}
        </EmptyState>
      )}
      {alerts.data && total > 0 && (
        <>
          <Card className="overflow-hidden p-0">
            <ul aria-label="Alerts" className="divide-y divide-base-300">
              {alerts.data.items.map((alert) => (
                <AlertRow key={alert.id} alert={alert} canManage={canManage} />
              ))}
            </ul>
          </Card>
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <span>
              {total} {total === 1 ? "alert" : "alerts"}
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
      <AlertSettingsCard canManage={canConfigure} />
    </div>
  );
}
