import type { Metadata } from "next";
import { Suspense } from "react";

import { LoginForm } from "@/features/auth/login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function Page() {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Sign in</h1>
      <p className="mt-1 mb-5 text-sm opacity-75">Welcome back to FleetPulse.</p>
      <Suspense fallback={<div className="skeleton h-40 w-full" />}>
        <LoginForm />
      </Suspense>
    </>
  );
}
