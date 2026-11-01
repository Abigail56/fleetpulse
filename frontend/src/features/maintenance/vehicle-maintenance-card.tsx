"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { DistanceUnit } from "@/lib/distance";

import { fetchSchedules, fetchWorkOrders, MAINTENANCE_KEY } from "./api";
import { ScheduleRow, WorkOrderRow } from "./rows";

const HISTORY_SHOWN = 5;

/** Shown on a vehicle's page: what's coming up, and its service history. */
export function VehicleMaintenanceCard({
  vehicleId,
  unit,
  canManage,
}: {
  vehicleId: string;
  unit: DistanceUnit;
  canManage: boolean;
}) {
  const schedules = useQuery({
    queryKey: [...MAINTENANCE_KEY, "schedules", "", vehicleId],
    queryFn: () => fetchSchedules({ vehicle: vehicleId }),
  });
  const filters = { search: "", status: "", type: "", vehicle: vehicleId, page: 1 };
  const orders = useQuery({
    queryKey: [...MAINTENANCE_KEY, "orders", "recent", filters],
    queryFn: () => fetchWorkOrders(filters, HISTORY_SHOWN),
  });

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Maintenance</h2>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <ButtonLink href={`/maintenance/schedules/new?vehicle=${vehicleId}`} variant="ghost">
              Add schedule
            </ButtonLink>
            <ButtonLink href={`/maintenance/work-orders/new?vehicle=${vehicleId}`} variant="outline">
              Add work order
            </ButtonLink>
          </div>
        )}
      </div>
      {(schedules.isError || orders.isError) && (
        <p className="mt-2 text-sm">Maintenance couldn&apos;t be loaded.</p>
      )}
      {schedules.data?.total === 0 && orders.data?.total === 0 && (
        <p className="mt-2 text-sm opacity-75">No schedules or service history yet.</p>
      )}
      {schedules.data && schedules.data.total > 0 && (
        <ul aria-label="Maintenance schedules" className="mt-3 divide-y divide-base-300 border-y border-base-300">
          {schedules.data.items.map((schedule) => (
            <ScheduleRow key={schedule.id} schedule={schedule} unit={unit} />
          ))}
        </ul>
      )}
      {orders.data && orders.data.total > 0 && (
        <>
          <h3 className="mt-4 text-sm font-semibold">Work orders and service history</h3>
          <ul aria-label="Service history" className="mt-2 divide-y divide-base-300 border-y border-base-300">
            {orders.data.items.map((order) => (
              <WorkOrderRow key={order.id} order={order} />
            ))}
          </ul>
          {orders.data.total > HISTORY_SHOWN && (
            <Link href={`/maintenance?vehicle=${vehicleId}`} className="link mt-3 inline-block text-sm">
              View all {orders.data.total}
            </Link>
          )}
        </>
      )}
    </Card>
  );
}
