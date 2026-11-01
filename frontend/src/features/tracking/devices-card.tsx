"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Radio } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, SelectInput, TextInput } from "@/components/ui/field";
import { StatusBadge } from "@/components/ui/status-badge";
import { fetchVehicles, VEHICLES_KEY } from "@/features/vehicles/api";

import {
  createDevice,
  type Device,
  fetchConfig,
  fetchDevices,
  TRACKING_KEY,
  updateDevice,
} from "./api";

const KEY = [...TRACKING_KEY, "devices"];

function validCoordinate(value: string, limit: number) {
  const number = Number(value);
  return value.trim() !== "" && Number.isFinite(number) && Math.abs(number) <= limit;
}

function AddDevice() {
  const queryClient = useQueryClient();
  const config = useQuery({ queryKey: [...TRACKING_KEY, "config"], queryFn: fetchConfig });
  const vehicles = useQuery({
    queryKey: [...VEHICLES_KEY, "picker", ""],
    queryFn: () =>
      fetchVehicles({
        search: "",
        status: "",
        vehicle_type: "",
        archived: false,
        sort: "registration_number",
        page: 1,
      }),
  });
  const [externalId, setExternalId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [simulated, setSimulated] = useState(false);
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");

  const ready = simulated
    ? Boolean(vehicleId) && validCoordinate(latitude, 90) && validCoordinate(longitude, 180)
    : externalId.trim() !== "";

  const add = useMutation({
    mutationFn: () =>
      createDevice(
        simulated
          ? {
              simulated: true,
              vehicle_id: vehicleId,
              start_latitude: Number(latitude),
              start_longitude: Number(longitude),
            }
          : {
              simulated: false,
              external_device_id: externalId.trim(),
              vehicle_id: vehicleId || null,
            },
      ),
    onSuccess: () => {
      toast.success("Device added.");
      setExternalId("");
      setVehicleId("");
      setLatitude("");
      setLongitude("");
      setSimulated(false);
      return queryClient.invalidateQueries({ queryKey: TRACKING_KEY });
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <form
      className="mt-4 flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) add.mutate();
      }}
    >
      {config.data?.simulator_enabled && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="checkbox checkbox-sm"
            checked={simulated}
            onChange={(event) => setSimulated(event.target.checked)}
          />
          Simulated device, for testing. Its positions are always labelled as simulated.
        </label>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {!simulated && (
          <Field id="external_device_id" label="Device ID" required hint="As your provider identifies it.">
            {(describedBy) => (
              <TextInput
                id="external_device_id"
                autoComplete="off"
                maxLength={128}
                aria-describedby={describedBy}
                value={externalId}
                onChange={(event) => setExternalId(event.target.value)}
              />
            )}
          </Field>
        )}
        <Field id="device_vehicle" label="Vehicle" required={simulated}>
          {() => (
            <SelectInput
              id="device_vehicle"
              value={vehicleId}
              onChange={(event) => setVehicleId(event.target.value)}
            >
              <option value="">{simulated ? "Choose a vehicle" : "Not assigned yet"}</option>
              {vehicles.data?.items.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.registration_number}
                </option>
              ))}
            </SelectInput>
          )}
        </Field>
        {simulated && (
          <>
            <Field id="start_latitude" label="Starting latitude" required>
              {() => (
                <TextInput
                  id="start_latitude"
                  inputMode="decimal"
                  value={latitude}
                  onChange={(event) => setLatitude(event.target.value)}
                />
              )}
            </Field>
            <Field id="start_longitude" label="Starting longitude" required>
              {() => (
                <TextInput
                  id="start_longitude"
                  inputMode="decimal"
                  value={longitude}
                  onChange={(event) => setLongitude(event.target.value)}
                />
              )}
            </Field>
          </>
        )}
      </div>
      <div>
        <Button type="submit" disabled={!ready || add.isPending}>
          Add device
        </Button>
      </div>
    </form>
  );
}

function DeviceRow({ device, canManage }: { device: Device; canManage: boolean }) {
  const queryClient = useQueryClient();
  const toggle = useMutation({
    mutationFn: () =>
      updateDevice(device.id, { status: device.status === "active" ? "inactive" : "active" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TRACKING_KEY }),
    onError: (error) => toast.error(error.message),
  });
  const active = device.status === "active";
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-medium break-all">{device.external_device_id}</span>
          {device.is_simulated && <StatusBadge status="info">Simulated</StatusBadge>}
          {!active && <StatusBadge status="neutral">Inactive</StatusBadge>}
        </p>
        <p className="mt-0.5 text-sm opacity-70">
          {device.registration_number ?? "Not assigned"},{" "}
          {device.last_seen_at
            ? `last reported ${formatDistanceToNow(new Date(device.last_seen_at), { addSuffix: true })}`
            : "nothing received yet"}
        </p>
      </div>
      {canManage && (
        <Button
          variant="ghost"
          disabled={toggle.isPending}
          aria-label={`${active ? "Deactivate" : "Activate"} ${device.external_device_id}`}
          onClick={() => toggle.mutate()}
        >
          {active ? "Deactivate" : "Activate"}
        </Button>
      )}
    </li>
  );
}

export function DevicesCard({ canManage }: { canManage: boolean }) {
  const devices = useQuery({ queryKey: KEY, queryFn: fetchDevices });
  return (
    <Card>
      <h2 className="text-lg font-semibold">Tracking devices</h2>
      {canManage && <AddDevice />}
      <div className="mt-5">
        {devices.isPending && <div className="skeleton h-14 w-full" />}
        {devices.isError && <Alert variant="error">{devices.error.message}</Alert>}
        {devices.data?.length === 0 && (
          <EmptyState icon={Radio} title="No tracking devices">
            Vehicle locations appear once a device is registered and sending positions.
          </EmptyState>
        )}
        {devices.data && devices.data.length > 0 && (
          <ul className="divide-y divide-base-300 border-y border-base-300">
            {devices.data.map((device) => (
              <DeviceRow key={device.id} device={device} canManage={canManage} />
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
