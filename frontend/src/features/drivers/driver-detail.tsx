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
import { SelectInput, TextInput } from "@/components/ui/field";
import type { CurrentMembership } from "@/features/organisation/api";
import { TripHistoryCard } from "@/features/trips/trip-history-card";
import { EntityDocumentsCard } from "@/features/compliance/entity-documents-card";
import { fetchVehicles, VEHICLES_KEY } from "@/features/vehicles/api";
import { ApiError } from "@/lib/api/client";

import {
  archiveDriver,
  assignVehicle,
  type Driver,
  DRIVERS_KEY,
  fetchAssignments,
  fetchDriver,
  restoreDriver,
  unassignVehicle,
} from "./api";
import { DriverAccountCard } from "./driver-account-card";
import { availabilityLabel, DriverStatusBadge, LicenceExpiry } from "./driver-badges";
import { DriverForm } from "./driver-form";

function useDriverFromRoute() {
  const { id } = useParams<{ id: string }>();
  return useQuery({ queryKey: [...DRIVERS_KEY, "detail", id], queryFn: () => fetchDriver(id) });
}

function LoadState({ query }: { query: ReturnType<typeof useDriverFromRoute> }) {
  if (query.isPending) {
    return (
      <div role="status" aria-label="Loading driver" className="flex flex-col gap-3">
        <div className="skeleton h-8 w-1/2" />
        <div className="skeleton h-48 w-full" />
      </div>
    );
  }
  if (query.error instanceof ApiError && query.error.status === 404) {
    return (
      <div className="flex flex-col items-start gap-3">
        <Alert variant="error">This driver doesn&apos;t exist, or isn&apos;t in this organisation.</Alert>
        <ButtonLink href="/drivers" variant="outline">
          Back to drivers
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

function AssignVehicle({ driver, onChange }: { driver: Driver; onChange: () => Promise<void> }) {
  const [search, setSearch] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const options = useQuery({
    queryKey: [...VEHICLES_KEY, "picker", search],
    queryFn: () =>
      fetchVehicles({
        search,
        status: "",
        vehicle_type: "",
        archived: false,
        sort: "registration_number",
        page: 1,
      }),
  });
  const assign = useMutation({
    mutationFn: () => assignVehicle(driver.id, vehicleId),
    onSuccess: async () => {
      toast.success("Vehicle assigned.");
      setVehicleId("");
      await onChange();
    },
    onError: (error) => toast.error(error.message),
  });
  const vehicles = options.data?.items ?? [];

  if (options.isSuccess && vehicles.length === 0 && !search) {
    return <p className="mt-2 text-sm opacity-75">Add a vehicle first, then assign it here.</p>;
  }
  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
      <TextInput
        type="search"
        aria-label="Search vehicles to assign"
        placeholder="Search registration"
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          setVehicleId("");
        }}
      />
      <SelectInput
        aria-label="Vehicle to assign"
        value={vehicleId}
        onChange={(event) => setVehicleId(event.target.value)}
      >
        <option value="">Choose a vehicle</option>
        {vehicles.map((vehicle) => (
          <option key={vehicle.id} value={vehicle.id}>
            {vehicle.registration_number} ({vehicle.make} {vehicle.model})
          </option>
        ))}
      </SelectInput>
      <Button disabled={!vehicleId || assign.isPending} onClick={() => assign.mutate()}>
        Assign
      </Button>
    </div>
  );
}

function Assignments({
  driver,
  canManage,
  onChange,
}: {
  driver: Driver;
  canManage: boolean;
  onChange: () => Promise<void>;
}) {
  const history = useQuery({
    queryKey: [...DRIVERS_KEY, "assignments", driver.id],
    queryFn: () => fetchAssignments(driver.id),
  });
  const unassign = useMutation({
    mutationFn: () => unassignVehicle(driver.id),
    onSuccess: async () => {
      toast.success("Vehicle unassigned.");
      await onChange();
    },
    onError: (error) => toast.error(error.message),
  });
  const current = driver.current_vehicle;
  const assignable = canManage && !driver.archived_at && driver.status === "active";

  return (
    <Card>
      <h2 className="text-lg font-semibold">Vehicle assignment</h2>
      {current ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">
            Currently assigned to{" "}
            <Link href={`/vehicles/${current.id}`} className="link font-mono font-medium">
              {current.registration_number}
            </Link>
          </p>
          {canManage && (
            <Button variant="outline" disabled={unassign.isPending} onClick={() => unassign.mutate()}>
              Unassign
            </Button>
          )}
        </div>
      ) : (
        <>
          <p className="mt-1 text-sm opacity-75">Not assigned to a vehicle.</p>
          {assignable && <AssignVehicle driver={driver} onChange={onChange} />}
          {canManage && !assignable && !driver.archived_at && (
            <p className="mt-2 text-sm opacity-75">Only an active driver can be assigned.</p>
          )}
        </>
      )}
      <h3 className="mt-6 text-sm font-semibold">History</h3>
      {history.isPending && <div className="skeleton mt-2 h-10 w-full" />}
      {history.isError && (
        <Alert variant="error" className="mt-2">
          {history.error.message}
        </Alert>
      )}
      {history.data?.length === 0 && <p className="mt-1 text-sm opacity-70">No assignments yet.</p>}
      {history.data && history.data.length > 0 && (
        <ul className="mt-2 divide-y divide-base-300 border-y border-base-300 text-sm">
          {history.data.map((item) => (
            <li key={item.id} className="flex flex-wrap justify-between gap-2 py-2">
              <span className="font-mono">{item.registration_number}</span>
              <span className="opacity-75">
                {format(new Date(item.started_at), "d MMM yyyy")} to{" "}
                {item.ended_at ? format(new Date(item.ended_at), "d MMM yyyy") : "now"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Details({ driver, membership }: { driver: Driver; membership: CurrentMembership }) {
  const queryClient = useQueryClient();
  const [confirmArchive, setConfirmArchive] = useState(false);
  const canManage = membership.permissions.includes("drivers.manage");
  const archived = driver.archived_at !== null;

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: DRIVERS_KEY });
    await queryClient.invalidateQueries({ queryKey: VEHICLES_KEY });
    await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  }

  const archive = useMutation({
    mutationFn: () => archiveDriver(driver.id),
    onSuccess: async () => {
      setConfirmArchive(false);
      toast.success("Driver archived.");
      await refresh();
    },
    onError: (error) => {
      setConfirmArchive(false);
      toast.error(error.message);
    },
  });
  const restore = useMutation({
    mutationFn: () => restoreDriver(driver.id),
    onSuccess: async () => {
      toast.success("Driver restored.");
      await refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  const rows: [string, React.ReactNode][] = [
    ["Availability", availabilityLabel(driver)],
    ...(driver.sensitive_visible
      ? ([
          ["Phone", driver.phone ?? "Not recorded"],
          ["Email", driver.email ?? "Not recorded"],
        ] as [string, React.ReactNode][])
      : []),
    ["Licence number", <span key="licence" className="font-mono">{driver.licence_number}</span>],
    ["Licence class", driver.licence_class ?? "Not recorded"],
    ["Licence country", driver.licence_country_code ?? "Not recorded"],
    ["Licence expiry", <LicenceExpiry key="expiry" date={driver.licence_expires_on} />],
  ];

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Link
        href="/drivers"
        className="inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline"
      >
        <ArrowLeft aria-hidden className="size-3.5" />
        All drivers
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {driver.first_name} {driver.last_name}
          </h1>
          <div className="mt-2">
            <DriverStatusBadge driver={driver} />
          </div>
        </div>
        {canManage && (
          <div className="flex gap-2">
            {archived ? (
              <Button disabled={restore.isPending} onClick={() => restore.mutate()}>
                Restore driver
              </Button>
            ) : (
              <>
                <ButtonLink href={`/drivers/${driver.id}/edit`}>Edit</ButtonLink>
                <Button variant="outline" onClick={() => setConfirmArchive(true)}>
                  Archive
                </Button>
              </>
            )}
          </div>
        )}
      </div>
      {!driver.sensitive_visible && (
        <Alert variant="info">
          Contact details and the full licence number are hidden for your role.
        </Alert>
      )}
      {archived && driver.archived_at && (
        <Alert variant="info">
          Archived on {format(new Date(driver.archived_at), "d MMM yyyy")}. Their history is kept,
          but they&apos;re left out of lists and dashboard figures.
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
      <Assignments driver={driver} canManage={canManage} onChange={refresh} />
      {membership.permissions.includes("compliance.view") &&
        membership.permissions.includes("drivers.view_sensitive") && (
          <EntityDocumentsCard
            driverId={driver.id}
            canManage={membership.permissions.includes("compliance.manage") && !archived}
          />
        )}
      {membership.permissions.includes("trips.view_all") && (
        <TripHistoryCard driverId={driver.id} />
      )}
      {canManage && membership.permissions.includes("members.view") && (
        <DriverAccountCard driver={driver} />
      )}
      <ConfirmDialog
        open={confirmArchive}
        title={`Archive ${driver.first_name} ${driver.last_name}?`}
        confirmLabel="Archive driver"
        busy={archive.isPending}
        onConfirm={() => archive.mutate()}
        onCancel={() => setConfirmArchive(false)}
      >
        They&apos;ll leave your lists and dashboard, and any vehicle assignment will end. Their
        history is kept, and you can restore them later.
      </ConfirmDialog>
    </div>
  );
}

export function DriverDetail({ membership }: { membership: CurrentMembership }) {
  const driver = useDriverFromRoute();
  if (!driver.data) return <LoadState query={driver} />;
  return <Details driver={driver.data} membership={membership} />;
}

export function EditDriver() {
  const driver = useDriverFromRoute();
  if (!driver.data) return <LoadState query={driver} />;
  if (driver.data.archived_at) {
    return (
      <div className="flex flex-col items-start gap-3">
        <Alert variant="info">Restore this driver before changing them.</Alert>
        <ButtonLink href={`/drivers/${driver.data.id}`} variant="outline">
          Back to driver
        </ButtonLink>
      </div>
    );
  }
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <h1 className="text-3xl font-bold tracking-tight">
        Edit {driver.data.first_name} {driver.data.last_name}
      </h1>
      <DriverForm key={driver.data.updated_at} driver={driver.data} />
    </div>
  );
}
