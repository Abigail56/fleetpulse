import type { Metadata } from "next";
import { Suspense } from "react";

import { SystemStatus } from "@/features/system-status/system-status";

export const metadata: Metadata = {
  title: "System status",
  robots: { index: false },
};

export default function StatusPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 px-4 py-16">
      <h1 className="text-3xl font-semibold">System status</h1>
      <Suspense
        fallback={<span className="badge badge-ghost">Checking services…</span>}
      >
        <SystemStatus />
      </Suspense>
    </main>
  );
}
