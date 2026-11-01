"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Alert } from "@/components/ui/alert";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { CurrentMembership } from "@/features/organisation/api";
import { TripHistoryCard } from "@/features/trips/trip-history-card";
import { EntityDocumentsCard } from "@/features/compliance/entity-documents-card";
import { VehicleCostsCard } from "@/features/costs/vehicle-costs-card";
import { VehicleMaintenanceCard } from "@/features/maintenance/vehicle-maintenance-card";
import { PositionCard } from "@/features/tracking/position-card";
import { ApiError } from "@/lib/api/client";
import { formatDistance } from "@/lib/distance";

import {
  archiveVehicle,
  fetchVehicle,
  FUEL_LABELS,
  OWNERSHIP_LABELS,
  restoreVehicle,
  TYPE_LABELS,
  type Vehicle,
  VEHICLES_KEY,
} from "./api";
import { VehicleForm } from "./vehicle-form";
import { VehicleStatusBadge } from "./vehicle-status-badge";

function useVehicleFromRoute() {
  const { id } = useParams<{ id: string }>();
  return useQuery({
    queryKey: [...VEHICLES_KEY, "detail", id],
    queryFn: () => fetchVehicle(id),
  });
}

function LoadState({ query }: { query: ReturnType<typeof useVehicleFromRoute> }) {
  if (query.isPending) {
    return (
      <div role="status" aria-label="Loading vehicle" className="flex flex-col gap-3">
        <div className="skeleton h-8 w-1/2" />
        <div className="skeleton h-48 w-full" />
      </div>
    );
  }
  if (query.error instanceof ApiError && query.error.status === 404) {
    return (
      <div className="flex flex-col items-start gap-3">
        <Alert variant="error">This vehicle doesn&apos;t exist, or isn&apos;t in this organisation.</Alert>
        <ButtonLink href="/vehicles" variant="outline">
          Back to vehicles
        </ButtonLink>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-3">
      <Alert variant="error">{query.error?.message}</Alert>
      <Button variant="outline" onClick={() => query.refetch()}>
        Try again
      </Button>
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/vehicles" className="inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline">
      <ArrowLeft aria-hidden className="size-3.5" />
      All vehicles
    </Link>
  );
}

function Details({ vehicle, membership }: { vehicle: Vehicle; membership: CurrentMembership }) {
  const queryClient = useQueryClient();
  const [confirmArchive, setConfirmArchive] = useState(false);
  const unit = membership.organisation.distance_unit;
  const canManage = membership.permissions.includes("vehicles.manage");
  const archived = vehicle.archived_at !== null;
  const canViewDrivers = membership.permissions.includes("drivers.view");

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: VEHICLES_KEY });
    await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  }

  const archive = useMutation({
    mutationFn: () => archiveVehicle(vehicle.id),
    onSuccess: async () => {
      setConfirmArchive(false);
      toast.success("Vehicle archived.");
      await refresh();
    },
    onError: (error) => {
      setConfirmArchive(false);
      toast.error(error.message);
    },
  });
  const restore = useMutation({
    mutationFn: () => restoreVehicle(vehicle.id),
    onSuccess: async () => {
      toast.success("Vehicle restored.");
      await refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  const rows: [string, React.ReactNode][] = [
    ["Make and model", `${vehicle.make} ${vehicle.model}`],
    ["Year", vehicle.year ?? "Not recorded"],
    ["Vehicle type", TYPE_LABELS[vehicle.vehicle_type]],
    ["Fuel type", FUEL_LABELS[vehicle.fuel_type]],
    ["Odometer", formatDistance(Number(vehicle.odometer_km), unit)],
    ["VIN", vehicle.vin ?? "Not recorded"],
    ["Ownership", OWNERSHIP_LABELS[vehicle.ownership_type]],
    ["Owner or lessor", vehicle.owner_name ?? "Not recorded"],
    ...(canViewDrivers
      ? ([
          [
            "Assigned driver",
            vehicle.current_driver ? (
              <Link key="driver" href={`/drivers/${vehicle.current_driver.id}`} className="link">
                {vehicle.current_driver.name}
              </Link>
            ) : (
              "None"
            ),
          ],
        ] as [string, React.ReactNode][])
      : []),
    ["Added", format(new Date(vehicle.created_at), "d MMM yyyy")],
  ];

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <BackLink />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-mono text-3xl font-medium tracking-tight">
            {vehicle.registration_number}
          </h1>
          <div className="mt-2">
            <VehicleStatusBadge vehicle={vehicle} />
          </div>
        </div>
        {canManage && (
          <div className="flex gap-2">
            {archived ? (
              <Button disabled={restore.isPending} onClick={() => restore.mutate()}>
                Restore vehicle
              </Button>
            ) : (
              <>
                <ButtonLink href={`/vehicles/${vehicle.id}/edit`}>Edit</ButtonLink>
                <Button variant="outline" onClick={() => setConfirmArchive(true)}>
                  Archive
                </Button>
              </>
            )}
          </div>
        )}
      </div>
      {archived && vehicle.archived_at && (
        <Alert variant="info">
          Archived on {format(new Date(vehicle.archived_at), "d MMM yyyy")}. It&apos;s kept for your
          records but left out of lists and dashboard figures.
        </Alert>
      )}
      <Card>
        <h2 className="text-lg font-semibold">Details</h2>
        <dl className="mt-3 divide-y divide-base-300 border-y border-base-300">
          {rows.map(([label, value]) => (
            <div key={label} className="grid gap-1 py-3 sm:grid-cols-[1fr_2fr]">
              <dt className="text-sm font-medium">{label}</dt>
              <dd className="text-sm">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <PositionCard vehicleId={vehicle.id} />
      {membership.permissions.includes("compliance.view") && (
        <EntityDocumentsCard
          vehicleId={vehicle.id}
          canManage={membership.permissions.includes("compliance.manage") && !archived}
        />
      )}
      {membership.permissions.includes("costs.view") && (
        <VehicleCostsCard
          vehicleId={vehicle.id}
          unit={membership.organisation.distance_unit}
          canSubmit={membership.permissions.includes("costs.submit") && !archived}
        />
      )}
      {membership.permissions.includes("maintenance.view") && (
        <VehicleMaintenanceCard
          vehicleId={vehicle.id}
          unit={membership.organisation.distance_unit}
          canManage={membership.permissions.includes("maintenance.manage") && !archived}
        />
      )}
      {membership.permissions.includes("trips.view_all") && (
        <TripHistoryCard vehicleId={vehicle.id} />
      )}
      <ConfirmDialog
        open={confirmArchive}
        title={`Archive ${vehicle.registration_number}?`}
        confirmLabel="Archive vehicle"
        busy={archive.isPending}
        onConfirm={() => archive.mutate()}
        onCancel={() => setConfirmArchive(false)}
      >
        It will leave your lists and dashboard, and any current driver assignment will end. Its
        history is kept, and you can restore it later.
      </ConfirmDialog>
    </div>
  );
}

export function VehicleDetail({ membership }: { membership: CurrentMembership }) {
  const vehicle = useVehicleFromRoute();
  if (!vehicle.data) return <LoadState query={vehicle} />;
  return <Details vehicle={vehicle.data} membership={membership} />;
}

export function EditVehicle({ membership }: { membership: CurrentMembership }) {
  const vehicle = useVehicleFromRoute();
  if (!vehicle.data) return <LoadState query={vehicle} />;
  if (vehicle.data.archived_at) {
    return (
      <div className="flex flex-col items-start gap-3">
        <Alert variant="info">Restore this vehicle before changing it.</Alert>
        <ButtonLink href={`/vehicles/${vehicle.data.id}`} variant="outline">
          Back to vehicle
        </ButtonLink>
      </div>
    );
  }
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <h1 className="text-3xl font-bold tracking-tight">
        Edit <span className="font-mono font-medium">{vehicle.data.registration_number}</span>
      </h1>
      <VehicleForm
        key={vehicle.data.updated_at}
        vehicle={vehicle.data}
        unit={membership.organisation.distance_unit}
      />
    </div>
  );
}
