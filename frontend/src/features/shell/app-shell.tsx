"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Building2,
  ChartColumn,
  ClipboardCheck,
  CreditCard,
  Fuel,
  Inbox,
  LayoutDashboard,
  Menu,
  Map as MapIcon,
  Bell,
  Radio,
  Route,
  Shapes,
  ShieldAlert,
  ShieldCheck,
  Truck,
  UserRound,
  Users,
  Wrench,
  Zap,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Logo } from "@/components/layout/logo";
import { Button } from "@/components/ui/button";
import { SelectInput } from "@/components/ui/field";
import { logout } from "@/features/auth/api";
import { useCurrentUser } from "@/features/auth/use-current-user";
import { fetchMine, KEYS, switchOrganisation } from "@/features/organisation/api";
import { useCurrentOrganisation } from "@/features/organisation/use-organisation";
import { ApiError } from "@/lib/api/client";
import { ALERT_REFRESH_MS, fetchAlertSummary, SUMMARY_KEY } from "@/features/alerts/api";
import { fetchUnreadCount, REFRESH_MS, UNREAD_KEY } from "@/features/notifications/api";
import { cn } from "@/lib/cn";
import { changeSession, subscribeToSessionChanges } from "@/lib/session-change";

function OrganisationSwitcher() {
  const current = useCurrentOrganisation();
  const mine = useQuery({ queryKey: KEYS.mine, queryFn: fetchMine });
  const switchTo = useMutation({
    mutationFn: switchOrganisation,
    onSuccess: () => changeSession("/dashboard"),
    onError: (error) => toast.error(error.message),
  });
  const organisations = mine.data ?? [];

  return (
    <div className="flex flex-col gap-1.5">
      {organisations.length > 1 ? (
        <>
          <label htmlFor="organisation-switcher" className="text-xs font-medium opacity-70">
            Organisation
          </label>
          <SelectInput
            id="organisation-switcher"
            value={current.data?.organisation.id ?? ""}
            disabled={switchTo.isPending}
            onChange={(event) => switchTo.mutate(event.target.value)}
          >
            {!current.data && <option value="">Choose…</option>}
            {organisations.map(({ organisation }) => (
              <option key={organisation.id} value={organisation.id}>
                {organisation.name}
              </option>
            ))}
          </SelectInput>
        </>
      ) : (
        current.data && <p className="truncate font-semibold">{current.data.organisation.name}</p>
      )}
      <Link href="/onboarding" className="link text-xs">
        {organisations.length === 0 ? "Set up an organisation" : "New organisation"}
      </Link>
    </div>
  );
}

function AlertCount() {
  const summary = useQuery({
    queryKey: SUMMARY_KEY,
    queryFn: fetchAlertSummary,
    refetchInterval: ALERT_REFRESH_MS,
  });
  const count = summary.data?.unacknowledged ?? 0;
  if (count === 0) return null;
  return (
    <span
      className={cn(
        "ml-auto badge badge-sm font-medium",
        summary.data?.critical ? "badge-error" : "badge-neutral",
      )}
    >
      {count}
      <span className="sr-only"> not acknowledged</span>
    </span>
  );
}

function UnreadCount() {
  const unread = useQuery({
    queryKey: UNREAD_KEY,
    queryFn: fetchUnreadCount,
    refetchInterval: REFRESH_MS,
  });
  const count = unread.data?.unread ?? 0;
  if (count === 0) return null;
  return (
    <span className="ml-auto badge badge-sm badge-neutral font-medium">
      {count}
      <span className="sr-only"> unread</span>
    </span>
  );
}

/** The sidebar is collapsed on phones, where the count would otherwise be out of sight. */
function HeaderAlerts() {
  const summary = useQuery({
    queryKey: SUMMARY_KEY,
    queryFn: fetchAlertSummary,
    refetchInterval: ALERT_REFRESH_MS,
  });
  if (!summary.data?.unacknowledged) return null;
  return (
    <Link href="/alerts" className="btn btn-ghost btn-sm gap-1.5">
      <Bell aria-hidden className="size-4" />
      <span className="sr-only">Alerts</span>
      <AlertCount />
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const user = useCurrentUser();
  const current = useCurrentOrganisation();
  const [open, setOpen] = useState(false);
  const permissions = current.data?.permissions ?? [];
  const links = [
    ...(current.data
      ? [
          { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
          ...(permissions.includes("vehicles.view")
            ? [{ href: "/map", label: "Live map", icon: MapIcon }]
            : []),
          ...(permissions.includes("trips.view")
            ? [{ href: "/trips", label: "Trips", icon: Route }]
            : []),
          ...(permissions.includes("alerts.view")
            ? [{ href: "/alerts", label: "Alerts", icon: Bell }]
            : []),
          ...(permissions.includes("alerts.view")
            ? [{ href: "/notifications", label: "Notifications", icon: Inbox }]
            : []),
          ...(permissions.includes("automation.manage")
            ? [{ href: "/automation", label: "Automation", icon: Zap }]
            : []),
          ...(permissions.includes("geofences.view")
            ? [{ href: "/geofences", label: "Geofences", icon: Shapes }]
            : []),
          ...(permissions.includes("maintenance.view")
            ? [{ href: "/maintenance", label: "Maintenance", icon: Wrench }]
            : []),
          ...(permissions.includes("costs.submit") || permissions.includes("costs.view")
            ? [{ href: "/costs", label: "Fuel and expenses", icon: Fuel }]
            : []),
          ...(permissions.includes("compliance.view") || permissions.includes("inspections.submit")
            ? [{ href: "/compliance", label: "Compliance", icon: ClipboardCheck }]
            : []),
          ...(permissions.includes("reports.view")
            ? [{ href: "/reports", label: "Reports", icon: ChartColumn }]
            : []),
          ...(permissions.includes("vehicles.view")
            ? [{ href: "/vehicles", label: "Vehicles", icon: Truck }]
            : []),
          ...(permissions.includes("vehicles.view")
            ? [{ href: "/tracking", label: "Tracking", icon: Radio }]
            : []),
          ...(permissions.includes("drivers.view")
            ? [{ href: "/drivers", label: "Drivers", icon: UserRound }]
            : []),
          ...(permissions.includes("members.view")
            ? [{ href: "/organisation/members", label: "Members", icon: Users }]
            : []),
          { href: "/organisation/settings", label: "Organisation", icon: Building2 },
        ]
      : []),
    ...(permissions.includes("billing.manage")
      ? [{ href: "/billing", label: "Billing", icon: CreditCard }]
      : []),
    { href: "/account", label: "Account security", icon: ShieldCheck },
    ...(user.data?.is_platform_admin
      ? [{ href: "/admin", label: "Platform administration", icon: ShieldAlert }]
      : []),
  ];

  useEffect(() => subscribeToSessionChanges(() => window.location.reload()), []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const signOut = useMutation({
    mutationFn: logout,
    onSuccess: () => changeSession("/login"),
    onError: (error) => {
      // Already signed out on the server: the goal has been met.
      if (error instanceof ApiError && error.status === 401) changeSession("/login");
      else toast.error(error.message);
    },
  });

  return (
    <div className="flex flex-1 flex-col md:flex-row">
      <a
        href="#app-content"
        className="sr-only z-50 rounded-field bg-primary px-4 py-2 text-primary-content focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <header className="flex h-14 items-center justify-between border-b border-base-300 bg-base-100 px-4 md:hidden">
        <Logo href="/dashboard" />
        <div className="flex items-center gap-1">
          {permissions.includes("alerts.view") && <HeaderAlerts />}
          <button
            type="button"
            className="btn btn-ghost btn-square"
            aria-expanded={open}
            aria-controls="app-sidebar"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X aria-hidden /> : <Menu aria-hidden />}
          </button>
        </div>
      </header>
      <aside
        id="app-sidebar"
        aria-label="Application"
        className={cn(
          "flex-col gap-6 border-b border-base-300 bg-base-100 p-4 md:sticky md:top-0 md:flex md:h-screen md:w-64 md:shrink-0 md:border-r md:border-b-0",
          open ? "flex" : "hidden",
        )}
      >
        <div className="hidden md:block">
          <Logo href="/dashboard" />
        </div>
        <OrganisationSwitcher />
        <nav aria-label="Main" className="flex flex-col gap-1">
          {links.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-field px-3 py-2 text-sm font-medium hover:bg-base-200",
                  active && "bg-base-200 text-primary",
                )}
              >
                <Icon aria-hidden className="size-4" />
                {label}
                {href === "/alerts" && <AlertCount />}
                {href === "/notifications" && <UnreadCount />}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto flex flex-col gap-2 border-t border-base-300 pt-4">
          {user.data && (
            <div className="min-w-0 text-sm">
              <p className="truncate font-medium">{user.data.full_name}</p>
              <p className="truncate text-xs opacity-70">{user.data.email}</p>
            </div>
          )}
          <Button variant="outline" disabled={signOut.isPending} onClick={() => signOut.mutate()}>
            Sign out
          </Button>
        </div>
      </aside>
      <main id="app-content" className="min-w-0 flex-1 bg-base-200">
        <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">{children}</div>
      </main>
    </div>
  );
}
