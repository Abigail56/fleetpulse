"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { BellOff } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SelectInput } from "@/components/ui/field";
import { type Status, StatusBadge } from "@/components/ui/status-badge";
import { ALERTS_KEY, SEVERITY_LABELS, type Severity, TYPE_LABELS } from "@/features/alerts/api";

import {
  type EmailMode,
  type EmailStatus,
  fetchNotifications,
  fetchPreferences,
  markAllRead,
  markRead,
  type NotificationItem,
  NOTIFICATIONS_KEY,
  PAGE_SIZE,
  type Preference,
  REFRESH_MS,
  savePreferences,
} from "./api";

const SEVERITY_STYLES: Record<Severity, Status> = {
  critical: "error",
  warning: "warning",
  info: "info",
};
const EMAIL_LABELS: Partial<Record<EmailStatus, string>> = {
  pending: "Email being sent",
  sent: "Email sent",
  failed: "Email couldn't be sent",
};
const MODE_LABELS: Record<EmailMode, string> = {
  off: "Never",
  critical: "Critical only",
  all: "Every alert",
};

function Row({ item }: { item: NotificationItem }) {
  const queryClient = useQueryClient();
  const read = useMutation({
    mutationFn: () => markRead(item.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
    },
    onError: (error) => toast.error(error.message),
  });
  return (
    <li className={item.read_at ? "flex flex-col gap-1 px-4 py-3" : "flex flex-col gap-1 bg-base-200 px-4 py-3"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={item.read_at ? "text-sm" : "text-sm font-semibold"}>
          {!item.read_at && <span className="sr-only">Unread: </span>}
          {item.title}
        </span>
        <StatusBadge status={SEVERITY_STYLES[item.severity]}>{SEVERITY_LABELS[item.severity]}</StatusBadge>
      </div>
      <p className="text-sm opacity-85">{item.body}</p>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs opacity-75">
        <span className="tabular-nums">{format(new Date(item.created_at), "d MMM yyyy, HH:mm")}</span>
        {EMAIL_LABELS[item.email_status] && <span>{EMAIL_LABELS[item.email_status]}</span>}
        <Link href="/alerts" className="link">
          Open alerts
        </Link>
        {!item.read_at && (
          <button
            type="button"
            className="link"
            disabled={read.isPending}
            aria-label={`Mark as read: ${item.title}`}
            onClick={() => read.mutate()}
          >
            Mark as read
          </button>
        )}
      </p>
    </li>
  );
}

function Preferences() {
  const queryClient = useQueryClient();
  const saved = useQuery({ queryKey: [...NOTIFICATIONS_KEY, "preferences"], queryFn: fetchPreferences });
  const [edits, setEdits] = useState<Record<string, Preference>>({});
  const rows = (saved.data ?? []).map((item) => edits[item.alert_type] ?? item);
  const save = useMutation({
    mutationFn: () => savePreferences(rows),
    onSuccess: async () => {
      setEdits({});
      toast.success("Preferences saved.");
      await queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
    },
    onError: (error) => toast.error(error.message),
  });
  return (
    <Card>
      <h2 className="text-lg font-semibold">Your preferences</h2>
      <p className="mt-1 text-sm opacity-75">
        These apply to you only, in this organisation. A rule set up by your organisation can still email
        you about something important.
      </p>
      {saved.isPending && <p className="mt-2 text-sm opacity-75">Loading preferences…</p>}
      {saved.isError && <Alert variant="error" className="mt-2">{saved.error.message}</Alert>}
      {saved.data && (
        <>
          <ul aria-label="Preferences" className="mt-3 divide-y divide-base-300 border-y border-base-300">
            {rows.map((item) => {
              const label = TYPE_LABELS[item.alert_type];
              return (
                <li key={item.alert_type} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="min-w-40 font-medium">{label}</span>
                  <span className="flex flex-wrap items-center gap-4">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        className="checkbox checkbox-sm"
                        aria-label={`${label}: show in FleetPulse`}
                        checked={item.in_app}
                        onChange={(event) =>
                          setEdits({ ...edits, [item.alert_type]: { ...item, in_app: event.target.checked } })
                        }
                      />
                      In app
                    </label>
                    <label className="flex items-center gap-2">
                      Email
                      <SelectInput
                        className="select-sm w-auto"
                        aria-label={`${label}: email`}
                        value={item.email_mode}
                        onChange={(event) =>
                          setEdits({
                            ...edits,
                            [item.alert_type]: { ...item, email_mode: event.target.value as EmailMode },
                          })
                        }
                      >
                        {(Object.keys(MODE_LABELS) as EmailMode[]).map((mode) => (
                          <option key={mode} value={mode}>
                            {MODE_LABELS[mode]}
                          </option>
                        ))}
                      </SelectInput>
                    </label>
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="mt-3">
            <Button
              variant="outline"
              disabled={save.isPending || Object.keys(edits).length === 0}
              onClick={() => save.mutate()}
            >
              {save.isPending ? "Saving…" : "Save preferences"}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

export function NotificationCentre() {
  const queryClient = useQueryClient();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);
  const notifications = useQuery({
    queryKey: [...NOTIFICATIONS_KEY, "list", page, unreadOnly],
    queryFn: () => fetchNotifications(page, unreadOnly),
    placeholderData: keepPreviousData,
    refetchInterval: REFRESH_MS,
  });
  const readAll = useMutation({
    mutationFn: markAllRead,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
      await queryClient.invalidateQueries({ queryKey: ALERTS_KEY });
    },
    onError: (error) => toast.error(error.message),
  });
  const total = notifications.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <h1 className="text-3xl font-bold tracking-tight">Notifications</h1>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="checkbox checkbox-sm"
            checked={unreadOnly}
            onChange={(event) => {
              setUnreadOnly(event.target.checked);
              setPage(1);
            }}
          />
          Unread only
        </label>
        <Button variant="ghost" disabled={readAll.isPending || total === 0} onClick={() => readAll.mutate()}>
          Mark all as read
        </Button>
      </div>
      {notifications.isPending && <p role="status" className="text-sm opacity-75">Loading notifications…</p>}
      {notifications.isError && !notifications.data && (
        <div className="flex flex-col items-start gap-3">
          <Alert variant="error">{notifications.error.message}</Alert>
          <Button variant="outline" onClick={() => void notifications.refetch()}>
            Try again
          </Button>
        </div>
      )}
      {notifications.data && total === 0 && (
        <EmptyState icon={BellOff} title={unreadOnly ? "Nothing unread" : "No notifications yet"}>
          Alerts you can act on appear here. Whether you hear about them depends on your role and the
          preferences below.
        </EmptyState>
      )}
      {notifications.data && total > 0 && (
        <>
          <Card className="overflow-hidden p-0">
            <ul aria-label="Notifications" className="divide-y divide-base-300">
              {notifications.data.items.map((item) => (
                <Row key={item.id} item={item} />
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
      <Preferences />
    </div>
  );
}
