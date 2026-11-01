import type { Metadata } from "next";
import { Suspense } from "react";

import { Providers } from "@/app/providers";
import { AuthGuard } from "@/features/auth/auth-guard";
import { AppShell } from "@/features/shell/app-shell";

export const metadata: Metadata = {
  title: { default: "FleetPulse", template: "%s | FleetPulse" },
  robots: { index: false },
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      {/* These read the URL, which isn't known at build time for routes like /vehicles/[id]. */}
      <Suspense
        fallback={
          <div role="status" aria-label="Loading" className="skeleton m-4 h-40 flex-1" />
        }
      >
        <AuthGuard>
          <AppShell>{children}</AppShell>
        </AuthGuard>
      </Suspense>
    </Providers>
  );
}
