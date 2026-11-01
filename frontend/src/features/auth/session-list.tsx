"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { MonitorSmartphone } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { changeSession } from "@/lib/session-change";

import {
  fetchSessions,
  logoutAll,
  revokeSession,
  SESSIONS_KEY,
  type UserSession,
} from "./api";
import { describeUserAgent } from "./describe-user-agent";

export function SessionList() {
  const queryClient = useQueryClient();
  const sessions = useQuery({ queryKey: SESSIONS_KEY, queryFn: fetchSessions });
  const [toRevoke, setToRevoke] = useState<UserSession | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);

  const revoke = useMutation({
    mutationFn: (session: UserSession) => revokeSession(session.id),
    onSuccess: (_result, session) => {
      setToRevoke(null);
      if (session.is_current) {
        changeSession("/login");
        return;
      }
      toast.success("That device has been signed out.");
      void queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });
    },
    onError: (error) => {
      setToRevoke(null);
      toast.error(error.message);
    },
  });
  const revokeAll = useMutation({
    mutationFn: logoutAll,
    onSuccess: () => changeSession("/login"),
    onError: (error) => {
      setConfirmAll(false);
      toast.error(error.message);
    },
  });

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Where you&apos;re signed in</h2>
          <p className="mt-1 text-sm opacity-75">
            Sign out any device you don&apos;t recognise, then change your password.
          </p>
        </div>
        <Button variant="outline" onClick={() => setConfirmAll(true)}>
          Sign out everywhere
        </Button>
      </div>
      <div className="mt-5">
        {sessions.isPending && (
          <div role="status" aria-label="Loading sessions" className="flex flex-col gap-2">
            <div className="skeleton h-14 w-full" />
            <div className="skeleton h-14 w-full" />
          </div>
        )}
        {sessions.isError && (
          <div className="flex flex-col items-start gap-3">
            <Alert variant="error">{sessions.error.message}</Alert>
            <Button variant="outline" onClick={() => sessions.refetch()}>
              Try again
            </Button>
          </div>
        )}
        {sessions.data?.length === 0 && (
          <EmptyState icon={MonitorSmartphone} title="No active sessions">
            Devices you sign in on will appear here.
          </EmptyState>
        )}
        {sessions.data && sessions.data.length > 0 && (
          <ul className="divide-y divide-base-300 border-y border-base-300">
            {sessions.data.map((session) => (
              <li key={session.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {describeUserAgent(session.user_agent)}
                    {session.is_current && <StatusBadge status="info">This device</StatusBadge>}
                  </p>
                  <p className="mt-0.5 text-sm opacity-70">
                    Active {formatDistanceToNow(new Date(session.last_active_at), { addSuffix: true })}
                  </p>
                </div>
                <Button variant="ghost" onClick={() => setToRevoke(session)}>
                  Sign out
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <ConfirmDialog
        open={toRevoke !== null}
        title="Sign out this device?"
        confirmLabel="Sign out"
        busy={revoke.isPending}
        onConfirm={() => toRevoke && revoke.mutate(toRevoke)}
        onCancel={() => setToRevoke(null)}
      >
        {toRevoke?.is_current
          ? "This is the device you're using, so you'll need to sign in again."
          : "It will need to sign in again before it can be used."}
      </ConfirmDialog>
      <ConfirmDialog
        open={confirmAll}
        title="Sign out everywhere?"
        confirmLabel="Sign out everywhere"
        busy={revokeAll.isPending}
        onConfirm={() => revokeAll.mutate()}
        onCancel={() => setConfirmAll(false)}
      >
        Every device, including this one, will need to sign in again.
      </ConfirmDialog>
    </Card>
  );
}
