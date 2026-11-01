"use client";

import { NotificationCentre } from "@/features/notifications/notification-centre";
import { RequireOrganisation } from "@/features/organisation/require-organisation";

export default function NotificationsPage() {
  return <RequireOrganisation>{() => <NotificationCentre />}</RequireOrganisation>;
}
