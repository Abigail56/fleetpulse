"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Plus, Zap } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { Alert } from "@/components/ui/alert";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { SelectInput } from "@/components/ui/field";
import { type Status, StatusBadge } from "@/components/ui/status-badge";
import { SEVERITY_LABELS, TYPE_LABELS } from "@/features/alerts/api";

import {
  archiveRule,
  AUTOMATION_KEY,
  fetchRules,
  fetchRuns,
  PAGE_SIZE,
  ROLE_LABELS,
  type Rule,
  type RuleAction,
  RUN_LABELS,
  type RunStatus,
  updateRule,
} from "./api";

const RUN_STYLES: Record<RunStatus, Status> = {
  pending: "info",
  succeeded: "success",
  skipped: "neutral",
  failed: "error",
};

export function describeAction(action: RuleAction) {
  if (action.type === "create_work_order") {
    return action.title ? `Create a work order: ${action.title}` : "Create a work order";
  }
  const roles = action.roles.map((role) => ROLE_LABELS[role]).join(", ");
  return `Notify ${roles}${action.email ? " by email too" : ""}`;
}

function RuleRow({ rule }: { rule: Rule }) {
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: AUTOMATION_KEY });
  const toggle = useMutation({
    mutationFn: () => updateRule(rule.id, { is_enabled: !rule.is_enabled }),
    onSuccess: refresh,
    onError: (error) => toast.error(error.message),
  });
  const archive = useMutation({
    mutationFn: () => archiveRule(rule.id),
    onSuccess: async () => {
      setConfirm(false);
      toast.success("Rule archived.");
      await refresh();
    },
    onError: (error) => {
      setConfirm(false);
      toast.error(error.message);
    },
  });
  return (
    <li className="flex flex-col gap-1.5 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{rule.name}</span>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            className="toggle toggle-sm"
            aria-label={`${rule.name}: on`}
            checked={rule.is_enabled}
            disabled={toggle.isPending}
            onChange={() => toggle.mutate()}
          />
          {rule.is_enabled ? "On" : "Off"}
        </label>
      </div>
      <p className="text-xs opacity-85">
        <span className="font-medium">When:</span>{" "}
        {rule.alert_types.map((type) => TYPE_LABELS[type]).join(", ")}, at{" "}
        {SEVERITY_LABELS[rule.min_severity].toLowerCase()} or above
        {rule.vehicle_id && ", for one vehicle"}
      </p>
      <p className="text-xs opacity-85">
        <span className="font-medium">Then:</span> {rule.actions.map(describeAction).join("; ")}
      </p>
      <p className="flex gap-3 text-xs">
        <Link href={`/automation/${rule.id}`} className="link" aria-label={`Edit ${rule.name}`}>
          Edit
        </Link>
        <button type="button" className="link" aria-label={`Archive ${rule.name}`} onClick={() => setConfirm(true)}>
          Archive
        </button>
      </p>
      <ConfirmDialog
        open={confirm}
        title="Archive this rule?"
        confirmLabel="Archive"
        busy={archive.isPending}
        onCancel={() => setConfirm(false)}
        onConfirm={() => archive.mutate()}
      >
        It stops running. Its history is kept.
      </ConfirmDialog>
    </li>
  );
}

export function AutomationOverview() {
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const rules = useQuery({ queryKey: [...AUTOMATION_KEY, "rules"], queryFn: fetchRules });
  const runs = useQuery({
    queryKey: [...AUTOMATION_KEY, "runs", page, status],
    queryFn: () => fetchRuns(page, status),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
  const total = runs.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex max-w-4xl flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight">Automation</h1>
        <ButtonLink href="/automation/new">
          <Plus aria-hidden className="size-4" />
          New rule
        </ButtonLink>
      </div>
      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Rules</h2>
        {rules.isPending && <p role="status" className="text-sm opacity-75">Loading rules…</p>}
        {rules.isError && <Alert variant="error">{rules.error.message}</Alert>}
        {rules.data?.length === 0 && (
          <EmptyState
            icon={Zap}
            title="No rules yet"
            action={<ButtonLink href="/automation/new">Create a rule</ButtonLink>}
          >
            For example, when insurance is about to expire, email the fleet managers. Or when maintenance
            falls due, create a work order.
          </EmptyState>
        )}
        {rules.data && rules.data.length > 0 && (
          <Card className="overflow-hidden p-0">
            <ul aria-label="Rules" className="divide-y divide-base-300">
              {rules.data.map((rule) => (
                <RuleRow key={rule.id} rule={rule} />
              ))}
            </ul>
          </Card>
        )}
      </section>
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-xl font-semibold">History</h2>
          <label className="flex flex-col gap-1 text-sm">
            Result
            <SelectInput
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All</option>
              {(Object.keys(RUN_LABELS) as RunStatus[]).map((item) => (
                <option key={item} value={item}>
                  {RUN_LABELS[item]}
                </option>
              ))}
            </SelectInput>
          </label>
        </div>
        {runs.isPending && <p role="status" className="text-sm opacity-75">Loading history…</p>}
        {runs.isError && <Alert variant="error">{runs.error.message}</Alert>}
        {runs.data && total === 0 && (
          <p className="text-sm opacity-75">{status ? "No runs match this filter." : "No rule has run yet."}</p>
        )}
        {runs.data && total > 0 && (
          <>
            <Card className="overflow-hidden p-0">
              <ul aria-label="History" className="divide-y divide-base-300 text-sm">
                {runs.data.items.map((run) => (
                  <li key={run.id} className="flex flex-col gap-1 px-4 py-3">
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{run.rule_name}</span>
                      <StatusBadge status={RUN_STYLES[run.status]}>{RUN_LABELS[run.status]}</StatusBadge>
                    </span>
                    <span className="text-xs opacity-85">{run.alert_title}</span>
                    <span className="text-xs opacity-75">
                      {format(new Date(run.created_at), "d MMM yyyy, HH:mm")}
                      {run.outcome && ` · ${run.outcome}`}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
            {pages > 1 && (
              <div className="flex items-center gap-2 text-sm">
                <Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Previous
                </Button>
                Page {page} of {pages}
                <Button variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                  Next
                </Button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
