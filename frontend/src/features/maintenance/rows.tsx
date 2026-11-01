import { format, parseISO } from "date-fns";
import Link from "next/link";

import { type DistanceUnit, formatDistance } from "@/lib/distance";
import { formatMoney } from "@/lib/money";

import { type Schedule, TYPE_LABELS, type WorkOrder } from "./api";
import { ScheduleStateBadge, WorkOrderStatusBadge } from "./badges";

export const formatDay = (value: string) => format(parseISO(value), "d MMM yyyy");

export function dueLabel(schedule: Schedule, unit: DistanceUnit) {
  const points = [
    ...(schedule.next_due_on ? [formatDay(schedule.next_due_on)] : []),
    ...(schedule.next_due_km !== null
      ? [formatDistance(Number(schedule.next_due_km), unit)]
      : []),
  ];
  return `Due ${points.join(" or at ")}`;
}

export function ScheduleRow({ schedule, unit }: { schedule: Schedule; unit: DistanceUnit }) {
  return (
    <li>
      <Link
        href={`/maintenance/schedules/${schedule.id}`}
        className="block px-4 py-3 transition-colors hover:bg-base-200"
      >
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium">
            {schedule.vehicle_registration} · {schedule.name}
          </span>
          <ScheduleStateBadge state={schedule.state} />
        </span>
        <span className="mt-1 block text-xs opacity-75">
          {dueLabel(schedule, unit)}
          {schedule.open_work_order_id && " · Work order booked"}
        </span>
      </Link>
    </li>
  );
}

export function WorkOrderRow({ order }: { order: WorkOrder }) {
  return (
    <li>
      <Link
        href={`/maintenance/work-orders/${order.id}`}
        className="block px-4 py-3 transition-colors hover:bg-base-200"
      >
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium">
            {order.vehicle_registration} · {order.title}
          </span>
          <WorkOrderStatusBadge status={order.status} />
        </span>
        <span className="mt-1 block text-xs opacity-75">
          {TYPE_LABELS[order.work_type]}
          {order.provider_name && ` · ${order.provider_name}`}
          {order.completed_on && ` · Completed ${formatDay(order.completed_on)}`}
          {!order.completed_on &&
            order.scheduled_for &&
            ` · Booked for ${formatDay(order.scheduled_for)}`}
          {order.total_cost !== null && ` · ${formatMoney(order.total_cost, order.currency)}`}
        </span>
      </Link>
    </li>
  );
}
