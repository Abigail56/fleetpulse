"use client";

import { useQuery } from "@tanstack/react-query";
import { Plus, Shapes } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import type { CurrentMembership } from "@/features/organisation/api";

import { fetchGeofences, GEOFENCES_KEY } from "./api";

export function GeofenceList({ membership }: { membership: CurrentMembership }) {
  const [archived, setArchived] = useState(false);
  const canManage = membership.permissions.includes("geofences.manage");
  const fences = useQuery({
    queryKey: [...GEOFENCES_KEY, "list", archived],
    queryFn: () => fetchGeofences(archived),
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight">Geofences</h1>
        {canManage && (
          <ButtonLink href="/geofences/new">
            <Plus aria-hidden className="size-4" />
            New geofence
          </ButtonLink>
        )}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="checkbox checkbox-sm"
          checked={archived}
          onChange={(event) => setArchived(event.target.checked)}
        />
        Show archived geofences
      </label>
      {fences.isPending && (
        <p role="status" className="text-sm opacity-75">
          Loading geofences…
        </p>
      )}
      {fences.isError && (
        <div className="flex flex-col items-start gap-3">
          <Alert variant="error">{fences.error.message}</Alert>
          <Button variant="outline" onClick={() => void fences.refetch()}>
            Try again
          </Button>
        </div>
      )}
      {fences.data?.length === 0 && (
        <EmptyState
          icon={Shapes}
          title={archived ? "No archived geofences" : "No geofences yet"}
          action={
            canManage && !archived ? (
              <ButtonLink href="/geofences/new">Create a geofence</ButtonLink>
            ) : undefined
          }
        >
          Draw an area such as a depot or a restricted site, and FleetPulse records vehicles entering
          and leaving it.
        </EmptyState>
      )}
      {fences.data && fences.data.length > 0 && (
        <Card className="overflow-hidden p-0">
          <ul aria-label="Geofences" className="divide-y divide-base-300">
            {fences.data.map((fence) => (
              <li key={fence.id}>
                <Link
                  href={`/geofences/${fence.id}`}
                  className="block px-4 py-3 transition-colors hover:bg-base-200"
                >
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{fence.name}</span>
                    {fence.is_restricted && <StatusBadge status="error">Restricted</StatusBadge>}
                  </span>
                  <span className="mt-1 block text-xs opacity-75">
                    {fence.kind === "circle" ? "Circle" : "Polygon"} · {fence.vehicles_inside}{" "}
                    {fence.vehicles_inside === 1 ? "vehicle" : "vehicles"} inside
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
