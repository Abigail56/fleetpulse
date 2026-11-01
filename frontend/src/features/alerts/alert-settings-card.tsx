"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, TextInput } from "@/components/ui/field";

import { ALERTS_KEY, type AlertSettings, fetchAlertSettings, updateAlertSettings } from "./api";

const MIN_OFFLINE = 5;
const MAX_OFFLINE = 43200;
const MAX_SPEED = 400;

function SettingsForm({ settings, canManage }: { settings: AlertSettings; canManage: boolean }) {
  const queryClient = useQueryClient();
  const [speed, setSpeed] = useState(settings.speed_limit_kph?.toString() ?? "");
  const [offlineOn, setOfflineOn] = useState(settings.offline_alerts_enabled);
  const [minutes, setMinutes] = useState(settings.offline_minutes.toString());
  const [licenceOn, setLicenceOn] = useState(settings.licence_alerts_enabled);
  const [maintenanceOn, setMaintenanceOn] = useState(settings.maintenance_alerts_enabled);
  const [documentsOn, setDocumentsOn] = useState(settings.document_alerts_enabled);
  const speedNumber = Number(speed);
  const minutesNumber = Number(minutes);
  const speedError =
    speed !== "" && !(Number.isInteger(speedNumber) && speedNumber >= 1 && speedNumber <= MAX_SPEED)
      ? `Use a whole number from 1 to ${MAX_SPEED}, or leave it blank.`
      : undefined;
  const minutesError = !(
    Number.isInteger(minutesNumber) &&
    minutesNumber >= MIN_OFFLINE &&
    minutesNumber <= MAX_OFFLINE
  )
    ? `Use a whole number from ${MIN_OFFLINE} to ${MAX_OFFLINE}.`
    : undefined;
  const save = useMutation({
    mutationFn: () =>
      updateAlertSettings({
        speed_limit_kph: speed === "" ? null : speedNumber,
        offline_alerts_enabled: offlineOn,
        offline_minutes: minutesNumber,
        licence_alerts_enabled: licenceOn,
        maintenance_alerts_enabled: maintenanceOn,
        document_alerts_enabled: documentsOn,
      }),
    onSuccess: async () => {
      toast.success("Alert settings saved.");
      await queryClient.invalidateQueries({ queryKey: ALERTS_KEY });
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <form
      noValidate
      className="mt-3 flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!speedError && !minutesError) save.mutate();
      }}
    >
      <Field
        id="speed_limit"
        label="Speed limit in km/h"
        hint="Blank turns speed alerts off. It takes two readings in a row above the limit, with a usable GPS signal."
        error={speedError}
      >
        {(describedBy) => (
          <TextInput
            id="speed_limit"
            inputMode="numeric"
            disabled={!canManage}
            value={speed}
            aria-invalid={speedError ? true : undefined}
            aria-describedby={describedBy}
            onChange={(event) => setSpeed(event.target.value.trim())}
          />
        )}
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="checkbox checkbox-sm"
          disabled={!canManage}
          checked={offlineOn}
          onChange={(event) => setOfflineOn(event.target.checked)}
        />
        Alert when a vehicle stops reporting
      </label>
      {offlineOn && (
        <Field
          id="offline_minutes"
          label="Minutes without a position"
          required
          hint="Vehicles last reported with the ignition off, or in maintenance, are left out, because they're expected to go quiet."
          error={minutesError}
        >
          {(describedBy) => (
            <TextInput
              id="offline_minutes"
              inputMode="numeric"
              disabled={!canManage}
              value={minutes}
              aria-invalid={minutesError ? true : undefined}
              aria-describedby={describedBy}
              onChange={(event) => setMinutes(event.target.value.trim())}
            />
          )}
        </Field>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="checkbox checkbox-sm"
          disabled={!canManage}
          checked={licenceOn}
          onChange={(event) => setLicenceOn(event.target.checked)}
        />
        Alert when a driver&apos;s licence is expired or expires within 30 days
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="checkbox checkbox-sm"
          disabled={!canManage}
          checked={maintenanceOn}
          onChange={(event) => setMaintenanceOn(event.target.checked)}
        />
        Alert when scheduled maintenance is due soon or overdue
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="checkbox checkbox-sm"
          disabled={!canManage}
          checked={documentsOn}
          onChange={(event) => setDocumentsOn(event.target.checked)}
        />
        Alert when a document is expired or expires within 30 days
      </label>
      {canManage && (
        <div>
          <Button type="submit" variant="outline" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save settings"}
          </Button>
        </div>
      )}
    </form>
  );
}

export function AlertSettingsCard({ canManage }: { canManage: boolean }) {
  const settings = useQuery({
    queryKey: [...ALERTS_KEY, "settings"],
    queryFn: fetchAlertSettings,
  });
  return (
    <Card>
      <h2 className="text-lg font-semibold">Alert settings</h2>
      {settings.isPending && <p className="mt-2 text-sm opacity-75">Loading settings…</p>}
      {settings.isError && <Alert variant="error" className="mt-2">{settings.error.message}</Alert>}
      {settings.data && <SettingsForm settings={settings.data} canManage={canManage} />}
    </Card>
  );
}
