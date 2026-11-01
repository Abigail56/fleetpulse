import type { Metadata } from "next";
import { Suspense } from "react";

import { AcceptInvitation } from "@/features/auth/accept-invitation";

export const metadata: Metadata = { title: "Join an organisation" };

export default function Page() {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Join an organisation</h1>
      <p className="mt-1 mb-5 text-sm opacity-75">You&apos;ve been invited to FleetPulse.</p>
      <Suspense fallback={<div className="skeleton h-40 w-full" />}>
        <AcceptInvitation />
      </Suspense>
    </>
  );
}
