import { differenceInCalendarDays, format, parseISO } from "date-fns";

import { type Status, StatusBadge } from "@/components/ui/status-badge";

import { AVAILABILITY_LABELS, type Driver, type DriverStatus, STATUS_LABELS } from "./api";

const STATUS_TONES: Record<DriverStatus, Status> = {
  active: "success",
  inactive: "neutral",
  suspended: "warning",
};

export function DriverStatusBadge({ driver }: { driver: Driver }) {
  if (driver.archived_at) return <StatusBadge status="neutral">Archived</StatusBadge>;
  return <StatusBadge status={STATUS_TONES[driver.status]}>{STATUS_LABELS[driver.status]}</StatusBadge>;
}

export function availabilityLabel(driver: Driver) {
  return AVAILABILITY_LABELS[driver.availability];
}

const WARNING_DAYS = 30;

export function LicenceExpiry({ date, today = new Date() }: { date: string | null; today?: Date }) {
  if (!date) return <span className="opacity-70">Not recorded</span>;
  const expires = parseISO(date);
  const days = differenceInCalendarDays(expires, today);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {format(expires, "d MMM yyyy")}
      {days < 0 && <StatusBadge status="error">Expired</StatusBadge>}
      {days >= 0 && days <= WARNING_DAYS && <StatusBadge status="warning">Expires soon</StatusBadge>}
    </span>
  );
}
