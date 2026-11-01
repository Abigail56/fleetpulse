import { type Status, StatusBadge } from "@/components/ui/status-badge";

import {
  type ScheduleState,
  STATE_LABELS,
  STATUS_LABELS,
  type WorkOrderStatus,
} from "./api";

const STATE_STYLES: Record<ScheduleState, Status> = {
  ok: "neutral",
  due_soon: "warning",
  overdue: "error",
};
const STATUS_STYLES: Record<WorkOrderStatus, Status> = {
  open: "info",
  in_progress: "warning",
  completed: "success",
  cancelled: "neutral",
};

export function ScheduleStateBadge({ state }: { state: ScheduleState }) {
  return <StatusBadge status={STATE_STYLES[state]}>{STATE_LABELS[state]}</StatusBadge>;
}

export function WorkOrderStatusBadge({ status }: { status: WorkOrderStatus }) {
  return <StatusBadge status={STATUS_STYLES[status]}>{STATUS_LABELS[status]}</StatusBadge>;
}
