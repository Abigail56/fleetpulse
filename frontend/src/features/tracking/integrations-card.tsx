"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";
import { toast } from "sonner";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TextInput } from "@/components/ui/field";

import {
  createIntegration,
  fetchIntegrations,
  type Integration,
  revokeIntegration,
  TRACKING_KEY,
} from "./api";

const KEY = [...TRACKING_KEY, "integrations"];

export function IntegrationsCard() {
  const queryClient = useQueryClient();
  const integrations = useQuery({ queryKey: KEY, queryFn: fetchIntegrations });
  const [name, setName] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [toRevoke, setToRevoke] = useState<Integration | null>(null);

  const create = useMutation({
    mutationFn: () => createIntegration(name.trim()),
    onSuccess: (created) => {
      setNewKey(created.key);
      setName("");
      return queryClient.invalidateQueries({ queryKey: KEY });
    },
    onError: (error) => toast.error(error.message),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => revokeIntegration(id),
    onSuccess: () => {
      setToRevoke(null);
      toast.success("Key revoked.");
      return queryClient.invalidateQueries({ queryKey: KEY });
    },
    onError: (error) => {
      setToRevoke(null);
      toast.error(error.message);
    },
  });

  return (
    <Card>
      <h2 className="text-lg font-semibold">Data feeds</h2>
      <p className="mt-1 text-sm opacity-75">
        A key lets a GPS provider or device platform send positions for this organisation. No
        tracking vendor is connected automatically.
      </p>
      {newKey && (
        <div className="mt-4">
          <Alert variant="success">
            <p className="font-semibold">Copy this key now. It won&apos;t be shown again.</p>
            <code className="mt-2 block font-mono text-xs break-all">{newKey}</code>
          </Alert>
        </div>
      )}
      <form
        className="mt-4 flex flex-wrap gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) create.mutate();
        }}
      >
        <TextInput
          aria-label="Feed name"
          placeholder="Feed name, such as your provider's"
          maxLength={100}
          value={name}
          className="min-w-0 flex-1 basis-56"
          onChange={(event) => setName(event.target.value)}
        />
        <Button type="submit" disabled={!name.trim() || create.isPending}>
          Create key
        </Button>
      </form>
      {integrations.isError && (
        <Alert variant="error" className="mt-3">
          {integrations.error.message}
        </Alert>
      )}
      {integrations.data && integrations.data.length > 0 && (
        <ul className="mt-4 divide-y divide-base-300 border-y border-base-300">
          {integrations.data.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div className="min-w-0">
                <p className="font-medium">{item.name}</p>
                <p className="text-sm opacity-70">
                  <span className="font-mono">{item.key_prefix}…</span>,{" "}
                  {item.last_used_at
                    ? `last used ${formatDistanceToNow(new Date(item.last_used_at), { addSuffix: true })}`
                    : "never used"}
                </p>
              </div>
              <Button
                variant="ghost"
                aria-label={`Revoke ${item.name}`}
                onClick={() => setToRevoke(item)}
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={toRevoke !== null}
        title={`Revoke ${toRevoke?.name ?? "this key"}?`}
        confirmLabel="Revoke key"
        busy={revoke.isPending}
        onConfirm={() => toRevoke && revoke.mutate(toRevoke.id)}
        onCancel={() => setToRevoke(null)}
      >
        Anything using this key will stop being able to send positions straight away.
      </ConfirmDialog>
    </Card>
  );
}
