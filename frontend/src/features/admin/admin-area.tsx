"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { useState } from "react";
import { toast } from "sonner";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, TextInput } from "@/components/ui/field";
import { type Status, StatusBadge } from "@/components/ui/status-badge";
import { ApiError } from "@/lib/api/client";
import { cn } from "@/lib/cn";

import {
  ADMIN_KEY,
  adminAction,
  fetchAdminSession,
  fetchAudit,
  fetchOrganisations,
  fetchSystem,
  fetchUsers,
  verifyAdmin,
} from "./api";

const PAGE_SIZE = 25;
const MIN_REASON = 5;
const TABS = ["System", "Organisations", "Users", "Audit log"] as const;
type Tab = (typeof TABS)[number];

const when = (iso: string | null) => (iso ? format(new Date(iso), "d MMM yyyy, HH:mm") : "Never");

function Pager({ page, total, onPage }: { page: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center gap-2 text-sm">
      <Button variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </Button>
      Page {page} of {pages}
      <Button variant="outline" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Next
      </Button>
    </div>
  );
}

/** Every support action asks why, and the answer goes in the audit log. */
function ActionButton({
  label,
  title,
  path,
  danger,
  explanation,
}: {
  label: string;
  title: string;
  path: string;
  danger?: boolean;
  explanation: string;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const run = useMutation({
    mutationFn: () => adminAction(path, reason.trim()),
    onSuccess: async () => {
      setOpen(false);
      setReason("");
      toast.success("Done, and recorded in the audit log.");
      await queryClient.invalidateQueries({ queryKey: ADMIN_KEY });
    },
    onError: (error) => {
      setOpen(false);
      toast.error(error.message);
    },
  });
  return (
    <>
      <Button variant={danger ? "outline" : "ghost"} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <ConfirmDialog
        open={open}
        title={title}
        confirmLabel={label}
        busy={run.isPending || reason.trim().length < MIN_REASON}
        onCancel={() => setOpen(false)}
        onConfirm={() => run.mutate()}
      >
        <p>{explanation}</p>
        <div className="mt-3">
          <Field id={`reason-${path}`} label="Reason" required hint="Recorded in the audit log.">
            {(describedBy) => (
              <TextInput
                id={`reason-${path}`}
                maxLength={500}
                value={reason}
                aria-describedby={describedBy}
                onChange={(event) => setReason(event.target.value)}
              />
            )}
          </Field>
        </div>
      </ConfirmDialog>
    </>
  );
}

const SERVICE_STYLES: Record<string, Status> = { ok: "success", unavailable: "error", not_configured: "neutral" };
const SERVICE_LABELS: Record<string, string> = {
  ok: "Working",
  unavailable: "Unavailable",
  not_configured: "Not set up",
};
const JOB_STYLES: Record<string, Status> = { ok: "success", late: "error", never: "warning", unknown: "neutral" };
const JOB_LABELS: Record<string, string> = {
  ok: "On time",
  late: "Late",
  never: "No success recorded yet",
  unknown: "Couldn't check",
};

function System() {
  const system = useQuery({ queryKey: [...ADMIN_KEY, "system"], queryFn: fetchSystem, refetchInterval: 30_000 });
  if (system.isPending) return <p role="status" className="text-sm opacity-75">Checking the system…</p>;
  if (!system.data) return <Alert variant="error">{system.error?.message}</Alert>;
  const { services, jobs, integrations, counts } = system.data;
  const figures: [string, number][] = [
    ["Organisations", counts.organisations],
    ["Users", counts.users],
    ["Vehicles", counts.vehicles],
    ["Paid subscriptions", counts.active_subscriptions],
    ["Emails waiting", counts.emails_waiting],
    ["Emails failed", counts.emails_failed],
    ["Automation runs failed", counts.automation_failed],
    ["Active GPS feed keys", counts.active_gps_feeds],
  ];
  return (
    <div className="flex flex-col gap-6">
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {figures.map(([label, value]) => (
          <Card key={label}>
            <dt className="text-sm opacity-75">{label}</dt>
            <dd className="mt-1 text-2xl font-bold tabular-nums">{value}</dd>
          </Card>
        ))}
      </dl>
      <Card>
        <h2 className="text-lg font-semibold">Services</h2>
        <ul aria-label="Services" className="mt-3 divide-y divide-base-300 border-y border-base-300 text-sm">
          {services.map((item) => (
            <li key={item.name} className="flex items-center justify-between gap-2 py-2.5">
              {item.name}
              <StatusBadge status={SERVICE_STYLES[item.state]}>{SERVICE_LABELS[item.state]}</StatusBadge>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h2 className="text-lg font-semibold">Background jobs</h2>
        <ul aria-label="Background jobs" className="mt-3 divide-y divide-base-300 border-y border-base-300 text-sm">
          {jobs.map((item) => (
            <li key={item.name} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <span>
                <span className="font-mono text-xs">{item.name}</span>
                <span className="block text-xs opacity-75">Last success: {when(item.last_success_at)}</span>
              </span>
              <StatusBadge status={JOB_STYLES[item.state]}>{JOB_LABELS[item.state]}</StatusBadge>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h2 className="text-lg font-semibold">Integrations</h2>
        <p className="mt-1 text-xs opacity-75">Set up means its settings exist. It doesn&apos;t prove it works.</p>
        <ul aria-label="Integrations" className="mt-3 divide-y divide-base-300 border-y border-base-300 text-sm">
          {integrations.map((item) => (
            <li key={item.name} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <span>
                {item.name}
                <span className="block text-xs opacity-75">{item.detail}</span>
              </span>
              <StatusBadge status={item.state === "configured" ? "info" : "neutral"}>
                {item.state === "configured" ? "Set up" : "Not set up"}
              </StatusBadge>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function SearchBox({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <TextInput type="search" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function Organisations() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const rows = useQuery({
    queryKey: [...ADMIN_KEY, "organisations", search, page],
    queryFn: () => fetchOrganisations(search, page),
    placeholderData: keepPreviousData,
  });
  return (
    <div className="flex flex-col gap-4">
      <SearchBox label="Search organisations" value={search} onChange={(value) => { setSearch(value); setPage(1); }} />
      {rows.isError && <Alert variant="error">{rows.error.message}</Alert>}
      {rows.data?.total === 0 && <p className="text-sm opacity-75">No organisations found.</p>}
      {rows.data && rows.data.total > 0 && (
        <Card className="overflow-hidden p-0">
          <ul aria-label="Organisations" className="divide-y divide-base-300 text-sm">
            {rows.data.items.map((item) => (
              <li key={item.id} className="flex flex-col gap-1 px-4 py-3">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{item.name}</span>
                  <StatusBadge status={item.status === "active" ? "success" : "error"}>
                    {item.status === "active" ? "Active" : "Suspended"}
                  </StatusBadge>
                </span>
                <span className="text-xs opacity-75">
                  {item.country_code} · {item.members} members · {item.vehicles} vehicles · Joined {when(item.created_at)}
                  {item.plan ? ` · ${item.plan}, paid until ${when(item.paid_until)}` : " · Not paying"}
                </span>
                <span>
                  {item.status === "active" ? (
                    <ActionButton
                      danger
                      label="Suspend"
                      title={`Suspend ${item.name}?`}
                      path={`organisations/${item.id}/suspend`}
                      explanation="Its members lose access straight away. Nothing is deleted."
                    />
                  ) : (
                    <ActionButton
                      label="Reactivate"
                      title={`Reactivate ${item.name}?`}
                      path={`organisations/${item.id}/reactivate`}
                      explanation="Its members get access back straight away."
                    />
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {rows.data && <Pager page={page} total={rows.data.total} onPage={setPage} />}
    </div>
  );
}

function Users() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const rows = useQuery({
    queryKey: [...ADMIN_KEY, "users", search, page],
    queryFn: () => fetchUsers(search, page),
    placeholderData: keepPreviousData,
  });
  return (
    <div className="flex flex-col gap-4">
      <SearchBox label="Search users" value={search} onChange={(value) => { setSearch(value); setPage(1); }} />
      {rows.isError && <Alert variant="error">{rows.error.message}</Alert>}
      {rows.data?.total === 0 && <p className="text-sm opacity-75">No users found.</p>}
      {rows.data && rows.data.total > 0 && (
        <Card className="overflow-hidden p-0">
          <ul aria-label="Users" className="divide-y divide-base-300 text-sm">
            {rows.data.items.map((item) => (
              <li key={item.id} className="flex flex-col gap-1 px-4 py-3">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium break-all">{item.email}</span>
                  <span className="flex items-center gap-1.5">
                    {item.is_platform_admin && <StatusBadge status="info">Staff</StatusBadge>}
                    <StatusBadge status={item.is_active ? "success" : "error"}>
                      {item.is_active ? "Active" : "Deactivated"}
                    </StatusBadge>
                  </span>
                </span>
                <span className="text-xs opacity-75">
                  {item.full_name} · {item.organisations} organisations · Last sign-in {when(item.last_login_at)}
                  {!item.email_verified && " · Email not verified"}
                </span>
                <span>
                  {item.is_active ? (
                    <ActionButton
                      danger
                      label="Deactivate"
                      title={`Deactivate ${item.email}?`}
                      path={`users/${item.id}/deactivate`}
                      explanation="They're signed out everywhere and can't sign in. Nothing is deleted."
                    />
                  ) : (
                    <ActionButton
                      label="Reactivate"
                      title={`Reactivate ${item.email}?`}
                      path={`users/${item.id}/reactivate`}
                      explanation="They'll be able to sign in again."
                    />
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {rows.data && <Pager page={page} total={rows.data.total} onPage={setPage} />}
    </div>
  );
}

function AuditLog() {
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);
  const rows = useQuery({
    queryKey: [...ADMIN_KEY, "audit", action, page],
    queryFn: () => fetchAudit(action, page),
    placeholderData: keepPreviousData,
  });
  return (
    <div className="flex flex-col gap-4">
      <SearchBox label="Filter by action" value={action} onChange={(value) => { setAction(value); setPage(1); }} />
      {rows.isError && <Alert variant="error">{rows.error.message}</Alert>}
      {rows.data?.total === 0 && <p className="text-sm opacity-75">No entries found.</p>}
      {rows.data && rows.data.total > 0 && (
        <Card className="overflow-hidden p-0">
          <ul aria-label="Audit log" className="divide-y divide-base-300 text-sm">
            {rows.data.items.map((item) => (
              <li key={item.id} className="flex flex-col gap-0.5 px-4 py-2.5">
                <span className="font-mono text-xs break-all">{item.action}</span>
                <span className="text-xs opacity-75">
                  {when(item.occurred_at)} · {item.actor_email ?? "System"}
                  {typeof item.details.reason === "string" && ` · Reason: ${item.details.reason}`}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {rows.data && <Pager page={page} total={rows.data.total} onPage={setPage} />}
    </div>
  );
}

function PasswordGate() {
  const queryClient = useQueryClient();
  const [password, setPassword] = useState("");
  const verify = useMutation({
    mutationFn: () => verifyAdmin(password),
    onSuccess: async () => {
      setPassword("");
      await queryClient.invalidateQueries({ queryKey: ADMIN_KEY });
    },
  });
  return (
    <Card className="max-w-md">
      <h2 className="text-lg font-semibold">Confirm your password</h2>
      <p className="mt-1 text-sm opacity-75">This area reaches every organisation. Access lasts 30 minutes.</p>
      <form
        className="mt-4 flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (password) verify.mutate();
        }}
      >
        {verify.isError && <Alert variant="error">{verify.error.message}</Alert>}
        <Field id="admin-password" label="Password" required>
          {(describedBy) => (
            <TextInput
              id="admin-password"
              type="password"
              autoComplete="current-password"
              value={password}
              aria-describedby={describedBy}
              onChange={(event) => setPassword(event.target.value)}
            />
          )}
        </Field>
        <div>
          <Button type="submit" disabled={verify.isPending || !password}>
            {verify.isPending ? "Checking…" : "Continue"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function AdminArea() {
  const [tab, setTab] = useState<Tab>("System");
  const session = useQuery({
    queryKey: [...ADMIN_KEY, "session"],
    queryFn: fetchAdminSession,
    retry: false,
  });
  const hidden = session.error instanceof ApiError && session.error.status === 404;

  if (session.isPending) return <p role="status" className="text-sm opacity-75">Loading…</p>;
  if (session.isError) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-bold tracking-tight">{hidden ? "Page not found" : "Platform administration"}</h1>
        <p className="text-sm opacity-75">{hidden ? "This page doesn't exist." : session.error.message}</p>
      </div>
    );
  }
  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <h1 className="text-3xl font-bold tracking-tight">Platform administration</h1>
      {!session.data.verified ? (
        <PasswordGate />
      ) : (
        <>
          <div role="group" aria-label="Sections" className="flex flex-wrap gap-2">
            {TABS.map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={tab === item}
                className={cn("btn btn-sm font-medium shadow-none", tab === item ? "btn-primary" : "btn-ghost")}
                onClick={() => setTab(item)}
              >
                {item}
              </button>
            ))}
          </div>
          {tab === "System" && <System />}
          {tab === "Organisations" && <Organisations />}
          {tab === "Users" && <Users />}
          {tab === "Audit log" && <AuditLog />}
        </>
      )}
    </div>
  );
}
